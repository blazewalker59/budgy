/**
 * A Household's own calendar and spending owners. Nothing here names one
 * Household's people; those live on the Household row (and its Accounts).
 */
import { eq } from 'drizzle-orm'
import { inHousehold } from './scope'
import type { HouseholdDatabase } from './scope'
import { accounts, households } from '@/lib/db/schema'
import { DEFAULT_TIME_ZONE } from '@/lib/model/dates'

export const DEFAULT_OWNERS = ['Joint']

/** An IANA zone Intl accepts, or the fallback. */
export function validTimeZone(value: string | null | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE
  try {
    Intl.DateTimeFormat('en-CA', { timeZone: value }).format()
    return value
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

/** Stored owner names. Empty or broken JSON falls back to Joint. */
export function parseOwners(value: string | null | undefined): Array<string> {
  if (!value) return [...DEFAULT_OWNERS]
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return [...DEFAULT_OWNERS]
    const names = [
      ...new Set(
        parsed
          .filter((name): name is string => typeof name === 'string')
          .map((name) => name.trim())
          .filter((name) => name.length > 0 && name.length <= 40),
      ),
    ]
    return names.length > 0 ? names : [...DEFAULT_OWNERS]
  } catch {
    return [...DEFAULT_OWNERS]
  }
}

export async function householdTimeZone(
  db: HouseholdDatabase,
): Promise<string> {
  const row = await db
    .select({ timeZone: households.timeZone })
    .from(households)
    .where(eq(households.id, db.householdId))
    .get()
  return validTimeZone(row?.timeZone)
}

/**
 * Owners this Household files by: the names it stores, plus anyone already
 * on an Account (a child added later, for instance).
 */
export async function householdOwners(
  db: HouseholdDatabase,
): Promise<Array<string>> {
  const [row, used] = await Promise.all([
    db
      .select({ owners: households.owners })
      .from(households)
      .where(eq(households.id, db.householdId))
      .get(),
    db
      .select({ owner: accounts.owner })
      .from(accounts)
      .where(inHousehold(db, accounts)),
  ])
  return [
    ...new Set([...parseOwners(row?.owners), ...used.map((a) => a.owner)]),
  ]
}
