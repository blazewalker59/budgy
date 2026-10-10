/** During closed rollout, creators are allowlisted; invitees and existing
 * Members can sign in without editing deployment secrets. */
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { LEGACY_HOUSEHOLD_ID } from './membership'
import type { Database } from '@/lib/db'
import { isAllowed } from '@/lib/auth/allowlist'
import { householdInvites, householdMembers, user } from '@/lib/db/schema'

/** Additional rollout gate for already-verified membership in the initial
 * Household. A pending invitation elsewhere must never bypass this gate. */
export async function canUseHousehold(
  db: Database,
  email: string,
  householdId: string,
  allowedEmails?: string,
) {
  if (householdId !== LEGACY_HOUSEHOLD_ID || isAllowed(email, allowedEmails))
    return true
  const invite = await db
    .select({ id: householdInvites.id })
    .from(householdInvites)
    .where(
      and(
        eq(householdInvites.householdId, householdId),
        eq(householdInvites.email, email.trim().toLowerCase()),
        sql`${householdInvites.acceptedAt} is not null`,
      ),
    )
    .get()
  return Boolean(invite)
}

export async function canSignIn(
  db: Database,
  email: string,
  allowedEmails?: string,
  now = new Date(),
) {
  if (isAllowed(email, allowedEmails)) return true
  const normalized = email.trim().toLowerCase()
  // Migration attaches pre-existing user rows. Do not restore access to an
  // old, removed allowlist entry merely because its historical user survived.
  // An accepted invitation is an explicit new grant for the initial Household.
  const membership = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(householdMembers, eq(user.id, householdMembers.memberId))
    .where(
      and(
        sql`lower(${user.email}) = ${normalized}`,
        sql`(${householdMembers.householdId} != ${LEGACY_HOUSEHOLD_ID} or exists (select 1 from ${householdInvites} where ${householdInvites.householdId} = ${householdMembers.householdId} and ${householdInvites.email} = ${normalized} and ${householdInvites.acceptedAt} is not null))`,
      ),
    )
    .get()
  if (membership) return true
  const invite = await db
    .select({ id: householdInvites.id })
    .from(householdInvites)
    .where(
      and(
        eq(householdInvites.email, normalized),
        isNull(householdInvites.revokedAt),
        isNull(householdInvites.acceptedAt),
        gt(householdInvites.expiresAt, now),
      ),
    )
    .get()
  return Boolean(invite)
}
