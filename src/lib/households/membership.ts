/** Server-side membership resolution; allowlisting alone never grants a Ledger. */
import { and, eq } from 'drizzle-orm'
import { householdDatabase } from './scope'
import { parseOwners, validTimeZone } from './locale'
import type { Database } from '@/lib/db'
import { householdMembers, households } from '@/lib/db/schema'

export const LEGACY_HOUSEHOLD_ID = 'hh_initial'

export async function findMemberHousehold(db: Database, memberId: string) {
  const memberships = await db
    .select({
      id: households.id,
      name: households.name,
      role: householdMembers.role,
      timeZone: households.timeZone,
      owners: households.owners,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.memberId, memberId))
  if (memberships.length > 1)
    throw new Error('A single Household membership is required')
  const membership = memberships[0]
  if (!membership) return null
  return {
    id: membership.id,
    name: membership.name,
    role: membership.role,
    timeZone: validTimeZone(membership.timeZone),
    owners: parseOwners(membership.owners),
  }
}

export async function memberHousehold(db: Database, memberId: string) {
  const household = await findMemberHousehold(db, memberId)
  if (!household) throw new Error('Household membership is required')
  return household
}

export async function requireHousehold(
  db: Database,
  memberId: string,
  householdId: string,
) {
  const membership = await db
    .select()
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.memberId, memberId),
        eq(householdMembers.householdId, householdId),
      ),
    )
    .get()
  if (!membership) throw new Error('Household access denied')
  return householdDatabase(db, householdId)
}
