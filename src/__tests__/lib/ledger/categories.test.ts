import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import {
  householdDatabase,
  householdRow,
  inHousehold,
} from '@/lib/households/scope'
import {
  categoryUses,
  deleteCategory,
  hideCategory,
  renameCategory,
} from '@/lib/ledger/categories'
import { dismissSuggestion, loadLedger } from '@/lib/ledger/queries'
import { RULES_KEY, loadBankCategories } from '@/lib/ledger/importer'
import { postTransactions, saveAccount } from '@/lib/ledger/accounts'
import {
  budgetTargets,
  categories,
  households,
  imports,
  moneyIn,
  plannedExpenses,
  savedLenses,
  settings,
  storeRules,
  transactions,
} from '@/lib/db/schema'

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
  const a = householdDatabase(db, 'a')
  const b = householdDatabase(newClient(), 'b')
  for (const scope of [a, b]) {
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
    await scope.insert(categories).values([
      householdRow(scope, {
        name: 'Food',
        tag: 'need' as const,
        group: 'everyday' as const,
      }),
      householdRow(scope, {
        name: 'Fun',
        tag: 'fluff' as const,
        group: 'everyday' as const,
      }),
      householdRow(scope, {
        name: 'Uncategorized',
        tag: 'nice' as const,
        group: 'everyday' as const,
      }),
    ])
    await scope.insert(imports).values(
      householdRow(scope, {
        id: 'im',
        fileName: 'x',
        account: 'Card',
        importedBy: 'm',
        added: 2,
        skipped: 0,
      }),
    )
    await scope.insert(transactions).values([
      householdRow(scope, {
        id: 't1',
        date: '2026-10-01',
        month: '2026-10',
        account: 'Card',
        description: 'Kroger',
        store: 'Kroger',
        sourceCategory: 'Food',
        amount: 500,
        importId: 'im',
      }),
      householdRow(scope, {
        id: 't2',
        date: '2026-10-02',
        month: '2026-10',
        account: 'Card',
        description: 'Cinema',
        store: 'Cinema',
        sourceCategory: 'Fun',
        category: 'Food',
        amount: 900,
        importId: 'im',
      }),
    ])
    await scope.insert(budgetTargets).values(
      householdRow(scope, {
        category: 'Food',
        startsMonth: '2026-10',
        amount: 1000,
      }),
    )
    await scope.insert(storeRules).values([
      householdRow(scope, {
        sourceCategory: 'Food',
        store: 'Kroger',
        category: null,
        tag: 'need' as const,
      }),
      householdRow(scope, {
        sourceCategory: '*',
        store: 'Aldi',
        category: 'Food',
      }),
    ])
    await scope.insert(plannedExpenses).values(
      householdRow(scope, {
        id: 'pe_1',
        name: 'Big shop',
        category: 'Food',
        store: null,
        amount: 2000,
        cadence: 'annual' as const,
        anchor: '2026-12-01',
      }),
    )
    await scope.insert(moneyIn).values(
      householdRow(scope, {
        id: 'mi1',
        account: 'Card',
        date: '2026-10-03',
        month: '2026-10',
        description: 'Refund',
        store: 'Kroger',
        amount: 100,
        use: 'offset' as const,
        category: 'Food',
        offset: 100,
        sourceKey: 'k1',
      }),
    )
    await scope.insert(savedLenses).values(
      householdRow(scope, {
        id: 'ln_1',
        name: 'Food lens',
        lens: { categories: ['Food', 'Fun'] },
        createdBy: 'm',
      }),
    )
    await dismissSuggestion(scope, 'cinema|Food')
  }
  return { a, b }
}

describe('Renaming a Category', () => {
  it('renames it in every row that names it, in this Household only', async () => {
    const { a, b } = await fixture()
    await renameCategory(a, 'Food', 'Groceries')
    const ledger = await loadLedger(a)
    expect(ledger.categories.map((c) => c.name)).toContain('Groceries')
    expect(ledger.categories.map((c) => c.name)).not.toContain('Food')
    expect(ledger.categories.find((c) => c.name === 'Groceries')).toMatchObject(
      { tag: 'need' as const, group: 'everyday' as const },
    )
    expect(ledger.txns.map((t) => [t.sourceCategory, t.category])).toEqual([
      ['Groceries', null],
      ['Fun', 'Groceries'],
    ])
    expect(ledger.targets).toEqual([
      { category: 'Groceries', startsMonth: '2026-10', amount: 1000 },
    ])
    expect(
      ledger.rules.map((r) => [r.sourceCategory, r.store, r.category]),
    ).toEqual(
      expect.arrayContaining([
        ['Groceries', 'Kroger', null],
        ['*', 'Aldi', 'Groceries'],
      ]),
    )
    expect(ledger.plans[0].category).toBe('Groceries')
    expect(ledger.lenses[0].lens.categories).toEqual(['Groceries', 'Fun'])
    expect(ledger.dismissed).toEqual(['cinema|Groceries'])
    const [offset] = await a
      .select()
      .from(moneyIn)
      .where(inHousehold(a, moneyIn))
    expect(offset.category).toBe('Groceries')
    expect((await categoryUses(a, 'Food')).purchases).toBe(0)

    // The other Household's Food is untouched.
    const theirs = await loadLedger(b)
    expect(theirs.categories.map((c) => c.name)).toContain('Food')
    expect(theirs.txns.map((t) => t.sourceCategory)).toEqual(['Food', 'Fun'])
    expect(theirs.targets[0].category).toBe('Food')
    expect(theirs.lenses[0].lens.categories).toEqual(['Food', 'Fun'])
    expect(theirs.dismissed).toEqual(['cinema|Food'])
    expect(
      (await b.select().from(moneyIn).where(inHousehold(b, moneyIn))).map(
        (m) => m.category,
      ),
    ).toEqual(['Food'])
  })

  it('files later imports that name the old Category under the new one', async () => {
    const { a, b } = await fixture()
    await renameCategory(a, 'Food', 'Groceries')
    expect(await loadBankCategories(a)).toEqual(
      new Map([['food', 'Groceries']]),
    )
    expect(await loadBankCategories(b)).toEqual(new Map())
    const row = {
      date: '2026-10-09',
      description: 'Corner market',
      amount: 12,
      category: 'food',
    }
    await postTransactions(a, {
      account: 'Card',
      rows: [row],
      commit: true,
      importedBy: 'm',
    })
    const ledger = await loadLedger(a)
    expect(
      ledger.txns.find((t) => t.store === 'Corner market')?.sourceCategory,
    ).toBe('Groceries')
    expect(ledger.categories.map((c) => c.name)).not.toContain('Food')
  })

  it('follows a renamed import bucket, like Home upkeep', async () => {
    const { a } = await fixture()
    await a.insert(categories).values(
      householdRow(a, {
        name: 'Home upkeep',
        tag: 'need' as const,
        group: 'housing' as const,
      }),
    )
    await a.insert(settings).values(
      householdRow(a, {
        key: RULES_KEY,
        value: JSON.stringify({
          stores: [],
          upkeep: '',
          hardware: ['Hardware'],
          mortgage: '',
          notSpending: '',
        }),
      }),
    )
    await renameCategory(a, 'Home upkeep', 'Repairs')
    await postTransactions(a, {
      account: 'Card',
      rows: [{ date: '2026-10-10', description: 'Ace Hardware', amount: 30 }],
      commit: true,
      importedBy: 'm',
    })
    const ledger = await loadLedger(a)
    expect(
      ledger.txns.find((t) => t.description === 'Ace Hardware')?.sourceCategory,
    ).toBe('Repairs')
    expect(ledger.categories.map((c) => c.name)).not.toContain('Home upkeep')
  })

  it('refuses a name already in use, and fixed names', async () => {
    const { a } = await fixture()
    await expect(renameCategory(a, 'Food', 'fun')).rejects.toThrow(
      'There’s already a category called fun.',
    )
    await expect(renameCategory(a, 'Food', 'Transfer')).rejects.toThrow(
      'can’t be changed',
    )
    await expect(renameCategory(a, 'Uncategorized', 'Misc')).rejects.toThrow(
      'can’t be changed',
    )
    await expect(renameCategory(a, 'Nope', 'Other')).rejects.toThrow(
      'There’s no category called Nope.',
    )
    expect((await loadLedger(a)).categories.map((c) => c.name)).toContain(
      'Food',
    )
  })

  it('allows a change of case alone', async () => {
    const { a } = await fixture()
    await renameCategory(a, 'Food', 'FOOD')
    const ledger = await loadLedger(a)
    expect(ledger.txns[0].sourceCategory).toBe('FOOD')
    expect(await loadBankCategories(a)).toEqual(new Map())
  })

  it('can’t rename another Household’s Category', async () => {
    const { a, b } = await fixture()
    await b.insert(categories).values(
      householdRow(b, {
        name: 'Theirs only',
        tag: 'nice' as const,
        group: 'everyday' as const,
      }),
    )
    await expect(renameCategory(a, 'Theirs only', 'Mine')).rejects.toThrow(
      'There’s no category called',
    )
    expect((await loadLedger(b)).categories.map((c) => c.name)).toContain(
      'Theirs only',
    )
  })
})

describe('Hiding and deleting a Category', () => {
  it('hides one in use and keeps its purchases', async () => {
    const { a, b } = await fixture()
    await hideCategory(a, 'Fun', true)
    const ledger = await loadLedger(a)
    expect(ledger.categories.find((c) => c.name === 'Fun')).toMatchObject({
      hidden: true,
    })
    expect(ledger.txns).toHaveLength(2)
    expect(
      (await loadLedger(b)).categories.find((c) => c.name === 'Fun')?.hidden,
    ).toBeUndefined()
    await hideCategory(a, 'Fun', false)
    expect(
      (await loadLedger(a)).categories.find((c) => c.name === 'Fun')?.hidden,
    ).toBeUndefined()
    await expect(hideCategory(a, 'Uncategorized', true)).rejects.toThrow(
      'can’t be changed',
    )
  })

  it('deletes only a Category nothing names', async () => {
    const { a, b } = await fixture()
    await expect(deleteCategory(a, 'Food')).rejects.toThrow(
      'Food is in use. Hide it instead.',
    )
    await a.insert(categories).values(
      householdRow(a, {
        name: 'Pets',
        tag: 'need' as const,
        group: 'everyday' as const,
      }),
    )
    await b.insert(categories).values(
      householdRow(b, {
        name: 'Pets',
        tag: 'need' as const,
        group: 'everyday' as const,
      }),
    )
    await a.insert(savedLenses).values(
      householdRow(a, {
        id: 'ln_2',
        name: 'Pets',
        lens: { categories: ['Pets'] },
        createdBy: 'm',
      }),
    )
    await deleteCategory(a, 'Pets')
    const ledger = await loadLedger(a)
    expect(ledger.categories.map((c) => c.name)).not.toContain('Pets')
    expect(ledger.lenses.find((l) => l.id === 'ln_2')?.lens.categories).toBe(
      undefined,
    )
    expect((await loadLedger(b)).categories.map((c) => c.name)).toContain(
      'Pets',
    )
  })
})
