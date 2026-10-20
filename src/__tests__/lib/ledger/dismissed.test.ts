import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { householdDatabase } from '@/lib/households/scope'
import { households } from '@/lib/db/schema'
import { dismissSuggestion, loadLedger } from '@/lib/ledger/queries'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

describe('dismissed rule suggestions', () => {
  it('are remembered once, per Household', async () => {
    const { db, sqlite, newClient } = testDatabase()
    open.push(sqlite)
    await db.insert(households).values([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ])
    const a = householdDatabase(newClient(), 'a')
    const b = householdDatabase(newClient(), 'b')
    expect((await loadLedger(a)).dismissed).toEqual([])
    await dismissSuggestion(a, 'corner shop|Groceries')
    await dismissSuggestion(a, 'corner shop|Groceries')
    await dismissSuggestion(a, 'elsewhere|Gifts')
    expect((await loadLedger(a)).dismissed).toEqual([
      'corner shop|Groceries',
      'elsewhere|Gifts',
    ])
    expect((await loadLedger(b)).dismissed).toEqual([])
  })
})
