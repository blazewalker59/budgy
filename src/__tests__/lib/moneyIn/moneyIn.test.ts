import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import type { AccountKind } from '@/lib/model/types'
import { householdDatabase } from '@/lib/households/scope'
import { households, moneyIn, transactions } from '@/lib/db/schema'
import { deleteAccount, saveAccount } from '@/lib/ledger/accounts'
import { fileMoneyIn, listMoneyIn, recordMoneyIn } from '@/lib/moneyIn/service'
import { guessUse, moneyInByMonth } from '@/lib/model/moneyIn'
import { ingestAccountExport } from '@/lib/updates/ingest'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

async function fixture() {
  const { db, sqlite, newClient } = testDatabase()
  open.push(sqlite)
  await db.insert(households).values([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ])
  const a = householdDatabase(newClient(), 'a')
  const b = householdDatabase(newClient(), 'b')
  const account = (name: string, kind: AccountKind) => ({
    name,
    owner: 'Joint',
    kind,
    institution: null,
    closed: false,
    securedBy: null,
  })
  for (const scope of [a, b]) {
    await saveAccount(scope, account('Checking', 'checking'), true)
    await saveAccount(scope, account('Card', 'credit'), true)
  }
  return { db, a, b }
}

const venmo = {
  date: '2026-10-12',
  description: 'VENMO CASHOUT',
  amount: 60_000,
}

describe('Money in', () => {
  it('guesses what incoming money is, leaving money from people to review', () => {
    expect(guessUse('VENMO CASHOUT PPD')).toBe('review')
    expect(guessUse('Zelle payment from Sam')).toBe('review')
    expect(guessUse('ACME PAYROLL DIRECT DEP')).toBe('income')
    expect(guessUse('Interest paid')).toBe('income')
    expect(guessUse('Online Transfer from Savings')).toBe('transfer')
    expect(guessUse('Mobile deposit')).toBe('review')
  })

  it('totals each month by use, counting only the offset part', () => {
    const base = {
      account: 'Checking',
      description: '',
      store: '',
      category: null,
      offset: null,
      note: null,
    }
    expect(
      moneyInByMonth([
        {
          ...base,
          id: '1',
          date: '2026-10-01',
          month: '2026-10',
          amount: 500,
          use: 'income',
        },
        {
          ...base,
          id: '2',
          date: '2026-10-02',
          month: '2026-10',
          amount: 300,
          use: 'offset',
          offset: 200,
        },
        {
          ...base,
          id: '3',
          date: '2026-09-02',
          month: '2026-09',
          amount: 100,
          use: 'review',
        },
      ]),
    ).toEqual([
      {
        month: '2026-10',
        income: 500,
        offsets: 200,
        transfers: 0,
        toReview: 0,
        total: 800,
      },
      {
        month: '2026-09',
        income: 0,
        offsets: 0,
        transfers: 0,
        toReview: 100,
        total: 100,
      },
    ])
  })

  it('records each incoming row once, by row or by connector id, in its own Household', async () => {
    const { a, b } = await fixture()
    expect(await recordMoneyIn(a, 'Checking', [venmo, venmo])).toBe(2)
    expect(await recordMoneyIn(a, 'Checking', [venmo, venmo])).toBe(0)
    expect(await recordMoneyIn(a, 'Checking', [venmo, venmo, venmo])).toBe(1)
    const synced = { ...venmo, sourceId: 'T1' }
    expect(await recordMoneyIn(a, 'Checking', [synced], 'simplefin:X')).toBe(1)
    expect(
      await recordMoneyIn(
        a,
        'Checking',
        [{ ...synced, description: 'Venmo (renamed)' }],
        'simplefin:X',
      ),
    ).toBe(0)
    expect(await listMoneyIn(a)).toHaveLength(4)
    expect(await listMoneyIn(b)).toHaveLength(0)
  })

  it('files an offset as a refund in its Category, changes it, and removes it when refiled', async () => {
    const { db, a, b } = await fixture()
    await recordMoneyIn(a, 'Checking', [venmo])
    const [item] = await listMoneyIn(a)
    expect(item.use).toBe('review')

    await fileMoneyIn(
      a,
      {
        id: item.id,
        use: 'offset',
        category: 'Blaze personal',
        offset: 59_000,
      },
      'Member',
    )
    let [refund] = await db.select().from(transactions)
    expect(refund).toMatchObject({
      householdId: 'a',
      account: 'Checking',
      date: '2026-10-12',
      amount: -59_000,
      category: 'Blaze personal',
      sourceKey: `money-in:${item.id}`,
    })

    // Changing it changes the same refund.
    await fileMoneyIn(
      a,
      { id: item.id, use: 'offset', category: 'Dining', offset: 60_000 },
      'Member',
    )
    const rows = await db.select().from(transactions)
    expect(rows).toHaveLength(1)
    ;[refund] = rows
    expect(refund).toMatchObject({ amount: -60_000, category: 'Dining' })
    expect((await listMoneyIn(a))[0]).toMatchObject({
      use: 'offset',
      category: 'Dining',
      offset: 60_000,
    })

    // Another Household can't file it.
    await expect(
      fileMoneyIn(b, { id: item.id, use: 'income' }, 'Member'),
    ).rejects.toThrow('no longer here')

    await fileMoneyIn(a, { id: item.id, use: 'income' }, 'Member')
    expect(await db.select().from(transactions)).toHaveLength(0)
    expect((await listMoneyIn(a))[0]).toMatchObject({
      use: 'income',
      category: null,
      offset: null,
    })
  })

  it('refuses an offset larger than the money, or to Transfer', async () => {
    const { db, a } = await fixture()
    await recordMoneyIn(a, 'Checking', [venmo])
    const [item] = await listMoneyIn(a)
    await expect(
      fileMoneyIn(
        a,
        { id: item.id, use: 'offset', category: 'Dining', offset: 60_001 },
        'Member',
      ),
    ).rejects.toThrow('at most')
    await expect(
      fileMoneyIn(
        a,
        { id: item.id, use: 'offset', category: 'Transfer' },
        'Member',
      ),
    ).rejects.toThrow('Choose the category')
    expect(await db.select().from(transactions)).toHaveLength(0)
  })

  it('keeps a bank export’s deposits on confirm, but not a card’s payments', async () => {
    const { a } = await fixture()
    const bank = {
      account: 'Checking',
      text: 'Date,Description,Debit,Credit\n2026-10-01,Grocer,5,\n2026-10-03,VENMO CASHOUT,,600',
      format: 'debit-credit' as const,
      commit: false,
    }
    const preview = await ingestAccountExport(a, bank, 'Member')
    expect(preview).toMatchObject({ incoming: 1, moneyInAdded: 0 })
    expect(await listMoneyIn(a)).toHaveLength(0)
    const done = await ingestAccountExport(
      a,
      { ...bank, commit: true },
      'Member',
    )
    expect(done.moneyInAdded).toBe(1)
    expect(await listMoneyIn(a)).toMatchObject([
      { account: 'Checking', amount: 60_000, use: 'review' },
    ])

    const card = await ingestAccountExport(
      a,
      {
        account: 'Card',
        text: 'Date,Description,Amount\n2026-10-01,Coffee,5\n2026-10-02,Payment Thank You,-100',
        format: 'spending-positive',
        commit: true,
      },
      'Member',
    )
    expect(card).toMatchObject({ incoming: 0, moneyInAdded: 0 })
  })

  it('goes with its Account', async () => {
    const { db, a, b } = await fixture()
    await recordMoneyIn(a, 'Checking', [venmo])
    await recordMoneyIn(b, 'Checking', [venmo])
    await deleteAccount(a, 'Checking')
    expect((await db.select().from(moneyIn)).map((m) => m.householdId)).toEqual(
      ['b'],
    )
  })
})
