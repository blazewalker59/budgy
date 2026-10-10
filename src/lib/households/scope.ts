/** Explicit, server-verified Ledger scope. Never inferred from client input. */
import { and, eq } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Database } from '@/lib/db'

export type HouseholdDatabase = Database & { readonly householdId: string }

/** Use only after membership verification, or for a trusted background job. */
export function householdDatabase(
  db: Database,
  householdId: string,
): HouseholdDatabase {
  if (!householdId) throw new Error('Household required')
  if ('householdId' in db && db.householdId !== householdId)
    throw new Error('Cannot rebind a Household database')
  Object.defineProperty(db, 'householdId', {
    value: householdId,
    enumerable: true,
  })
  return db as HouseholdDatabase
}

export function inHousehold(
  scope: HouseholdDatabase,
  table: { householdId: SQLiteColumn },
  condition?: SQL,
): SQL {
  if (!scope.householdId) throw new Error('Household required')
  return and(eq(table.householdId, scope.householdId), condition)!
}

export function householdRow<T extends object>(
  scope: HouseholdDatabase,
  row: T,
) {
  if (!scope.householdId) throw new Error('Household required')
  return { ...row, householdId: scope.householdId }
}
