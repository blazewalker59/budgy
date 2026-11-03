import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { householdDatabase } from '@/lib/households/scope'
import { households } from '@/lib/db/schema'
import { loadSetup, saveSetup } from '@/lib/ledger/setup'
import { loadLedger } from '@/lib/ledger/queries'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

describe('Setup marks', () => {
  it('are kept per Household', async () => {
    const { db, sqlite, newClient } = testDatabase()
    open.push(sqlite)
    await db.insert(households).values([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ])
    const a = householdDatabase(db, 'a')
    const b = householdDatabase(newClient(), 'b')
    await saveSetup(a, { step: 'categories', mark: 'done' })
    await saveSetup(a, { step: 'bills', mark: 'skipped' })
    await expect(saveSetup(a, { dismissed: true })).resolves.toEqual({
      skipped: ['bills'],
      done: ['categories'],
      dismissed: true,
    })
    expect((await loadLedger(a)).setup).toEqual({
      skipped: ['bills'],
      done: ['categories'],
      dismissed: true,
    })
    expect(await loadSetup(b)).toEqual({
      skipped: [],
      done: [],
      dismissed: false,
    })
    await saveSetup(a, { step: 'bills', mark: null })
    expect((await loadSetup(a)).skipped).toEqual([])
  })
})
