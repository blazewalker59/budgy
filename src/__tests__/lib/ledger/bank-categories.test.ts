import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { householdDatabase, householdRow } from '@/lib/households/scope'
import { categories, households } from '@/lib/db/schema'
import { postTransactions, saveAccount } from '@/lib/ledger/accounts'
import { loadLedger, moveTransaction } from '@/lib/ledger/queries'
import {
  fileBankCategory,
  listBankCategories,
} from '@/lib/ledger/bankCategories'
import {
  bankKey,
  parseBankCategories,
  resolveBankCategory,
} from '@/lib/import/bankCategories'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

const rows = [
  {
    date: '2026-10-01',
    description: 'Taco Place',
    amount: 20,
    category: 'Restaurants',
  },
  {
    date: '2026-10-02',
    description: 'Pizza Spot',
    amount: 30,
    category: 'restaurants ',
  },
  {
    date: '2026-10-03',
    description: 'Kroger',
    amount: 50,
    category: 'Groceries',
  },
  { date: '2026-10-04', description: 'Gas Co', amount: 40, category: 'Gas' },
]

async function fixture() {
  const { db, sqlite, newClient } = testDatabase()
  open.push(sqlite)
  await db.insert(households).values([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ])
  const a = householdDatabase(db, 'a')
  const b = householdDatabase(newClient(), 'b')
  for (const scope of [a, b]) {
    await scope.insert(categories).values(
      ['Groceries', 'Drinks & dining', 'Auto & transport'].map((name) =>
        householdRow(scope, {
          name,
          tag: 'need' as const,
          group: 'everyday' as const,
        }),
      ),
    )
    await saveAccount(
      scope,
      {
        name: 'Card',
        owner: 'Joint',
        kind: 'credit',
        institution: null,
        closed: false,
        securedBy: null,
      },
      true,
    )
    await postTransactions(scope, {
      account: 'Card',
      rows,
      commit: true,
      importedBy: 'm',
    })
  }
  return { a, b }
}

const filed = async (db: Parameters<typeof loadLedger>[0]) =>
  Object.fromEntries(
    (await loadLedger(db)).txns.map((t) => [t.store, t.sourceCategory]),
  )

describe('Bank categories', () => {
  it('keeps the bank’s name and lists the ones not yet filed', async () => {
    const { a } = await fixture()
    expect(await filed(a)).toEqual({
      'Taco Place': 'Uncategorized',
      'Pizza Spot': 'Uncategorized',
      Kroger: 'Groceries',
      'Gas Co': 'Uncategorized',
    })
    expect(await listBankCategories(a)).toEqual([
      {
        name: expect.stringMatching(/^restaurants$/i),
        purchases: 2,
        unsorted: 2,
        spent: 5000,
        means: null,
      },
      { name: 'Gas', purchases: 1, unsorted: 1, spent: 4000, means: null },
    ])
  })

  it('files past and later purchases, in this Household only', async () => {
    const { a, b } = await fixture()
    await expect(
      fileBankCategory(a, 'RESTAURANTS', 'Drinks & dining'),
    ).resolves.toEqual({ moved: 2 })
    expect(await filed(a)).toMatchObject({
      'Taco Place': 'Drinks & dining',
      'Pizza Spot': 'Drinks & dining',
    })
    await postTransactions(a, {
      account: 'Card',
      rows: [
        {
          date: '2026-10-08',
          description: 'Noodle Bar',
          amount: 15,
          category: 'Restaurants',
        },
      ],
      commit: true,
      importedBy: 'm',
    })
    expect((await filed(a))['Noodle Bar']).toBe('Drinks & dining')
    expect((await listBankCategories(a))[1]).toMatchObject({
      unsorted: 0,
      means: 'Drinks & dining',
    })
    // The other Household is untouched, now and on its next import.
    expect((await filed(b))['Taco Place']).toBe('Uncategorized')
    await postTransactions(b, {
      account: 'Card',
      rows: [
        {
          date: '2026-10-08',
          description: 'Noodle Bar',
          amount: 15,
          category: 'Restaurants',
        },
      ],
      commit: true,
      importedBy: 'm',
    })
    expect((await filed(b))['Noodle Bar']).toBe('Uncategorized')
  })

  it('leaves a Moved purchase where it was Moved', async () => {
    const { a } = await fixture()
    const taco = (await loadLedger(a)).txns.find(
      (t) => t.store === 'Taco Place',
    )!
    await moveTransaction(a, taco.id, 'Groceries')
    await fileBankCategory(a, 'Restaurants', 'Drinks & dining')
    const after = (await loadLedger(a)).txns.find((t) => t.id === taco.id)!
    expect(after.category).toBe('Groceries')
  })

  it('changes or clears what one means, moving its purchases along', async () => {
    const { a } = await fixture()
    await fileBankCategory(a, 'Gas', 'Drinks & dining')
    await fileBankCategory(a, 'Gas', 'Auto & transport')
    expect((await filed(a))['Gas Co']).toBe('Auto & transport')
    await fileBankCategory(a, 'Gas', null)
    expect((await filed(a))['Gas Co']).toBe('Uncategorized')
    expect(
      (await listBankCategories(a)).find((c) => c.name === 'Gas')?.means,
    ).toBe(null)
  })

  it('refuses Uncategorized as a meaning', async () => {
    const { a } = await fixture()
    await expect(fileBankCategory(a, 'Gas', 'Uncategorized')).rejects.toThrow(
      'Choose a category.',
    )
  })
})

describe('Resolving a bank’s category name', () => {
  it('prefers the Household’s own Category, then a meaning', () => {
    const cats = new Map([['groceries', 'Groceries']])
    const meanings = new Map([
      ['restaurants', 'Drinks & dining'],
      ['market', 'groceries'],
    ])
    expect(resolveBankCategory(' GROCERIES ', cats, meanings)).toBe('Groceries')
    expect(resolveBankCategory('Restaurants', cats, meanings)).toBe(
      'Drinks & dining',
    )
    expect(resolveBankCategory('Market', cats, meanings)).toBe('Groceries')
    expect(resolveBankCategory('Gas', cats, meanings)).toBeUndefined()
    expect(bankKey('  Fast   Food ')).toBe('fast food')
    expect(parseBankCategories('not json')).toEqual(new Map())
    expect(parseBankCategories('{"a":"B","c":3}')).toEqual(
      new Map([['a', 'B']]),
    )
  })
})
