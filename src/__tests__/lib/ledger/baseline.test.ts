import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { householdDatabase } from '@/lib/households/scope'
import { households } from '@/lib/db/schema'
import { loadLedger, saveBaseline } from '@/lib/ledger/queries'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

describe('net worth baseline', () => {
  it('is kept per Household, replaced when set again, and cleared back to automatic', async () => {
    const { db, sqlite, newClient } = testDatabase()
    open.push(sqlite)
    await db.insert(households).values([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ])
    const a = householdDatabase(newClient(), 'a')
    const b = householdDatabase(newClient(), 'b')
    expect((await loadLedger(a)).baseline).toBeNull()
    await saveBaseline(a, '2026-10-08')
    await saveBaseline(a, '2026-10-09')
    expect((await loadLedger(a)).baseline).toBe('2026-10-09')
    expect((await loadLedger(b)).baseline).toBeNull()
    await saveBaseline(a, null)
    expect((await loadLedger(a)).baseline).toBeNull()
  })
})
