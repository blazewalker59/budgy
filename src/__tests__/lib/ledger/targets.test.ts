import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { householdDatabase, householdRow } from '@/lib/households/scope'
import { budgetTargets, households } from '@/lib/db/schema'
import { saveTargets } from '@/lib/ledger/targets'
import { loadLedger } from '@/lib/ledger/queries'

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
  return {
    a: householdDatabase(db, 'a'),
    b: householdDatabase(newClient(), 'b'),
  }
}

describe('Setting many Targets at once', () => {
  it('sets each from the month on, keeping earlier months', async () => {
    const { a, b } = await fixture()
    await a.insert(budgetTargets).values(
      householdRow(a, {
        category: 'Groceries',
        startsMonth: '2026-09',
        amount: 50_000,
      }),
    )
    await saveTargets(a, '2026-11', [
      { category: 'Groceries', amount: 60_000 },
      { category: 'Pets', amount: 8_000 },
    ])
    await saveTargets(a, '2026-11', [{ category: 'Pets', amount: 9_000 }])
    const ledger = await loadLedger(a)
    expect(
      ledger.targets.sort((x, y) =>
        (x.category + x.startsMonth).localeCompare(y.category + y.startsMonth),
      ),
    ).toEqual([
      { category: 'Groceries', startsMonth: '2026-09', amount: 50_000 },
      { category: 'Groceries', startsMonth: '2026-11', amount: 60_000 },
      { category: 'Pets', startsMonth: '2026-11', amount: 9_000 },
    ])
    expect(ledger.categories.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Groceries', 'Pets']),
    )
    expect((await loadLedger(b)).targets).toEqual([])
  })

  it('refuses a Category twice or a Transfer', async () => {
    const { a } = await fixture()
    await expect(
      saveTargets(a, '2026-11', [
        { category: 'Pets', amount: 1 },
        { category: 'Pets', amount: 2 },
      ]),
    ).rejects.toThrow('Each category once')
    await expect(
      saveTargets(a, '2026-11', [{ category: 'Transfer', amount: 1 }]),
    ).rejects.toThrow('Transfers have no Target.')
    expect((await loadLedger(a)).targets).toEqual([])
  })
})
