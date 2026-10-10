/**
 * The signed-in Member, for server functions. Server-only: kept apart from
 * the server-function modules so the client bundle never pulls in auth or
 * the database.
 *
 * During rollout, sign-in requires creator allowlisting, an invitation, or
 * existing membership. Ledger access always requires Household membership
 * (docs/adr/0007 and 0008).
 */

import { getAuth } from './server'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { Household } from '@/lib/households/service'
import { getCloudflareEnv, getDb, serverRequestContext } from '@/lib/db'
import {
  LEGACY_HOUSEHOLD_ID,
  findMemberHousehold,
  requireHousehold,
} from '@/lib/households/membership'
import { householdMembers } from '@/lib/db/schema'
import { canSignIn, canUseHousehold } from '@/lib/households/admission'

export interface Member {
  id: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
}

export type SessionState =
  | { status: 'member'; member: Member; household: Household }
  | { status: 'no-household'; member: Member }
  | { status: 'not-allowed'; email: string }
  | { status: 'signed-out' }

export async function sessionState(): Promise<SessionState> {
  const env = getCloudflareEnv()
  // Local development can act as a Member without Google (never in a build).
  if (import.meta.env.DEV && env.DEV_MEMBER_EMAIL) {
    const email = env.DEV_MEMBER_EMAIL
    const db = getDb()
    await db
      .insert(householdMembers)
      .values({
        householdId: LEGACY_HOUSEHOLD_ID,
        memberId: 'dev',
        role: 'owner',
      })
      .onConflictDoNothing()
    const household = await findMemberHousehold(db, 'dev')
    if (!household) throw new Error('Run local database migrations first')
    return {
      status: 'member',
      member: {
        id: 'dev',
        name: email.split('@')[0],
        email,
        image: null,
        emailVerified: true,
      },
      household,
    }
  }
  const headers = serverRequestContext.getStore()?.headers
  if (!headers) return { status: 'signed-out' }
  const session = await getAuth(env).api.getSession({ headers })
  if (!session?.user) return { status: 'signed-out' }
  const db = getDb()
  if (!(await canSignIn(db, session.user.email, env.ALLOWED_EMAILS)))
    return { status: 'not-allowed', email: session.user.email }
  const member = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
    emailVerified: session.user.emailVerified,
  }
  const household = await findMemberHousehold(db, member.id)
  if (
    household &&
    !(await canUseHousehold(db, member.email, household.id, env.ALLOWED_EMAILS))
  )
    return { status: 'not-allowed', email: member.email }
  return household
    ? { status: 'member', member, household }
    : { status: 'no-household', member }
}

export async function requireMember(): Promise<Member> {
  const state = await sessionState()
  if (state.status !== 'member' && state.status !== 'no-household')
    throw new Error('Sign in required')
  return state.member
}

/** Run with the Ledger's database, for a signed-in Member only. */
export async function withMember<T>(
  fn: (scope: { db: Database; member: Member }) => Promise<T>,
): Promise<T> {
  const state = await sessionState()
  if (state.status === 'signed-out' || state.status === 'not-allowed')
    throw new Error('Sign in required')
  if (state.status !== 'member')
    throw new Error('Household membership is required')
  const member = state.member
  const db = getDb()
  return fn({
    db: await requireHousehold(db, member.id, state.household.id),
    member,
  })
}
