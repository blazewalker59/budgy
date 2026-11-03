/**
 * The signed-in Member, for server functions. Server-only: kept apart from
 * the server-function modules so the client bundle never pulls in auth or
 * the database.
 *
 * During rollout, sign-in requires creator allowlisting, an invitation, or
 * existing membership. Ledger access always requires Household membership
 * (docs/adr/0007 and 0008).
 */

import { eq } from 'drizzle-orm'
import { getAuth } from './server'
import { isAdmin } from './admins'
import type { CloudflareEnv, Database } from '@/lib/db'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { Household } from '@/lib/households/service'
import type { Persona } from '@/lib/demo/service'
import { actingPersona, endDemo } from '@/lib/demo/service'
import { getCloudflareEnv, getDb, serverRequestContext } from '@/lib/db'
import {
  LEGACY_HOUSEHOLD_ID,
  findMemberHousehold,
  requireHousehold,
} from '@/lib/households/membership'
import { householdMembers, households, session, user } from '@/lib/db/schema'
import { canSignIn, canUseHousehold } from '@/lib/households/admission'
import { UserError } from '@/lib/errors'

export interface Member {
  id: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
  /** A Demo persona an admin is acting as (docs/adr/0015). */
  demo?: boolean
}

/** Who is really at the keyboard while a Demo persona is acted as. */
export interface DemoContext {
  persona: { id: string; name: string; email: string }
  admin: { name: string; email: string }
}

/** `admin`: may open /admin (a hint for the menu; every admin request
 * checks again). `demo`: the Member is a Demo persona an admin acts as. */
interface Roles {
  admin?: boolean
  demo?: DemoContext
}

export type SessionState =
  | ({ status: 'member'; member: Member; household: Household } & Roles)
  | ({ status: 'no-household'; member: Member } & Roles)
  | { status: 'not-allowed'; email: string }
  | { status: 'signed-out' }

/**
 * The person signed in to this browser, admitted, and their Better Auth
 * session: never a Demo persona. Admin requests start here.
 */
export interface SignedIn {
  member: Member
  sessionId: string | null
  /** The local DEV_MEMBER_EMAIL bypass, already a Member of hh_initial. */
  dev: boolean
}

export async function signedIn(
  env: CloudflareEnv,
  db: Database,
): Promise<
  SignedIn | { status: 'signed-out' | 'not-allowed'; email?: string }
> {
  // Local development can act as a Member without Google (never in a build).
  if (import.meta.env.DEV && env.DEV_MEMBER_EMAIL) {
    const email = env.DEV_MEMBER_EMAIL
    // A user row, as Google sign-in would make: tokens are admitted by it.
    await db
      .insert(user)
      .values({
        id: 'dev',
        name: email.split('@')[0],
        email,
        emailVerified: true,
      })
      .onConflictDoNothing()
    await db
      .insert(householdMembers)
      .values({
        householdId: LEGACY_HOUSEHOLD_ID,
        memberId: 'dev',
        role: 'owner',
      })
      .onConflictDoNothing()
    // A session row, as sign-in would make, for a demo session to bind to.
    await db
      .insert(session)
      .values({
        id: 'dev',
        token: 'dev',
        userId: 'dev',
        expiresAt: new Date('2100-01-01'),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
    return {
      member: {
        id: 'dev',
        name: email.split('@')[0],
        email,
        image: null,
        emailVerified: true,
      },
      sessionId: 'dev',
      dev: true,
    }
  }
  const headers = serverRequestContext.getStore()?.headers
  if (!headers) return { status: 'signed-out' }
  const auth = await getAuth(env).api.getSession({ headers })
  if (!auth?.user) return { status: 'signed-out' }
  // Admission is by email, so an email Google hasn't verified admits nobody.
  if (!auth.user.emailVerified)
    return { status: 'not-allowed', email: auth.user.email }
  if (!(await canSignIn(db, auth.user.email, env.ALLOWED_EMAILS)))
    return { status: 'not-allowed', email: auth.user.email }
  return {
    member: {
      id: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
      image: auth.user.image ?? null,
      emailVerified: auth.user.emailVerified,
    },
    sessionId: auth.session?.id ?? null,
    dev: false,
  }
}

export async function sessionState(): Promise<SessionState> {
  const env = getCloudflareEnv()
  const db = getDb()
  const who = await signedIn(env, db)
  if (!('member' in who))
    return who.status === 'not-allowed'
      ? { status: 'not-allowed', email: who.email ?? '' }
      : { status: 'signed-out' }
  const admin = isAdmin(who.member.email, env.ADMIN_EMAILS)
  const roles: Roles = admin ? { admin } : {}
  // An admin acting as a Demo persona is that persona from here on: every
  // server function sees only it (docs/adr/0015).
  const persona = await actingPersona(db, who.sessionId, who.member.id, admin)
  if (persona) {
    const acting = await personaState(db, env, persona, who.member)
    if (acting) return acting
    // Anything unexpected ends the demo, back to the admin's own Ledger.
    await endDemo(db, who.sessionId!)
  }
  const member = who.member
  const household = await findMemberHousehold(db, member.id)
  if (household && !who.dev) {
    if (
      !(await canUseHousehold(
        db,
        member.email,
        household.id,
        env.ALLOWED_EMAILS,
      ))
    )
      return { status: 'not-allowed', email: member.email }
  }
  if (who.dev && !household)
    throw new Error('Run local database migrations first')
  return household
    ? { status: 'member', member, household, ...roles }
    : { status: 'no-household', member, ...roles }
}

async function personaState(
  db: Database,
  env: CloudflareEnv,
  persona: Persona,
  admin: Member,
): Promise<SessionState | null> {
  const member: Member = {
    id: persona.id,
    name: persona.name,
    email: persona.email,
    image: null,
    emailVerified: true,
    demo: true,
  }
  if (
    !(await canSignIn(db, member.email, env.ALLOWED_EMAILS, new Date(), {
      demoSession: true,
    }))
  )
    return null
  const household = await findMemberHousehold(db, member.id)
  if (household && !(await isDemoHousehold(db, household.id))) return null
  const demo: DemoContext = {
    persona: { id: persona.id, name: persona.name, email: persona.email },
    admin: { name: admin.name, email: admin.email },
  }
  return household
    ? { status: 'member', member, household, admin: true, demo }
    : { status: 'no-household', member, admin: true, demo }
}

async function isDemoHousehold(db: Database, householdId: string) {
  const row = await db
    .select({ demo: households.demo })
    .from(households)
    .where(eq(households.id, householdId))
    .get()
  return row?.demo === true
}

export async function requireMember(): Promise<Member> {
  const state = await sessionState()
  if (state.status !== 'member' && state.status !== 'no-household')
    throw new UserError('Sign in required')
  return state.member
}

/** Run with the Ledger's database, for a signed-in Member only. */
export async function withMember<T>(
  fn: (scope: { db: HouseholdDatabase; member: Member }) => Promise<T>,
): Promise<T> {
  const state = await sessionState()
  if (state.status === 'signed-out' || state.status === 'not-allowed')
    throw new UserError('Sign in required')
  if (state.status !== 'member')
    throw new UserError('Household membership is required')
  const member = state.member
  const db = getDb()
  return fn({
    db: await requireHousehold(db, member.id, state.household.id),
    member,
  })
}
