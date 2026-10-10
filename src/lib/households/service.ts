/** Household creation and membership changes. Authorization is enforced here,
 * as well as in server functions, so other entry points cannot bypass it. */
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { inHousehold } from './scope'
import { findMemberHousehold, memberHousehold } from './membership'
import type { Database } from '@/lib/db'
import type { HouseholdDatabase } from './scope'
import { hashToken } from '@/lib/agents/tokens'
import {
  apiTokens,
  categories,
  householdInvites,
  householdMembers,
  households,
  user,
} from '@/lib/db/schema'
import { DEFAULT_CATEGORIES } from '@/lib/model/defaults'
import { rowsPerInsert } from '@/lib/ledger/importer'

export interface HouseholdActor {
  id: string
  email: string
  emailVerified: boolean
}
export type Household = { id: string; name: string; role: 'owner' | 'member' }

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
const stamp = sql`cast(unixepoch('subsecond') * 1000 as integer)`
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const MAX_INVITES = 20

function verified(actor: HouseholdActor) {
  if (!actor.emailVerified)
    throw new Error('Sign in with a verified Google account')
}

function ownerGuard(db: HouseholdDatabase, actorId: string) {
  return sql`exists (select 1 from ${householdMembers} where ${householdMembers.householdId} = ${db.householdId} and ${householdMembers.memberId} = ${actorId} and ${householdMembers.role} = 'owner')`
}

async function requireOwner(db: HouseholdDatabase, actor: HouseholdActor) {
  verified(actor)
  const membership = await db
    .select()
    .from(householdMembers)
    .where(
      inHousehold(
        db,
        householdMembers,
        and(
          eq(householdMembers.memberId, actor.id),
          eq(householdMembers.role, 'owner'),
        ),
      ),
    )
    .get()
  if (!membership)
    throw new Error('Only the Household owner can manage membership')
}

export async function createHousehold(
  db: Database,
  actor: HouseholdActor,
  name: string,
): Promise<Household> {
  verified(actor)
  name = name.trim()
  if (!name || name.length > 60)
    throw new Error('Name your Household (up to 60 characters)')
  if (await findMemberHousehold(db, actor.id))
    throw new Error('You already belong to a Household')
  const id = `hh_${crypto.randomUUID().replaceAll('-', '')}`
  // A unique membership per Member makes simultaneous create/join attempts
  // conflict; D1's atomic batch rolls the losing attempt back completely.
  const defaults = DEFAULT_CATEGORIES.map((category) => ({
    ...category,
    householdId: id,
  }))
  const categoryInserts = []
  const perInsert = rowsPerInsert(categories)
  for (let i = 0; i < defaults.length; i += perInsert)
    categoryInserts.push(
      db.insert(categories).values(defaults.slice(i, i + perInsert)),
    )
  await db.batch([
    db.insert(households).values({ id, name }),
    db
      .insert(householdMembers)
      .values({ householdId: id, memberId: actor.id, role: 'owner' }),
    ...categoryInserts,
  ])
  return { id, name, role: 'owner' }
}

export async function householdDetails(
  db: HouseholdDatabase,
  actor: HouseholdActor,
) {
  const household = await memberHousehold(db, actor.id)
  if (household.id !== db.householdId)
    throw new Error('Household access denied')
  const members = await db
    .select({
      id: householdMembers.memberId,
      name: user.name,
      email: user.email,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .leftJoin(user, eq(user.id, householdMembers.memberId))
    .where(inHousehold(db, householdMembers))
  const invites =
    household.role === 'owner'
      ? await db
          .select({
            id: householdInvites.id,
            email: householdInvites.email,
            expiresAt: householdInvites.expiresAt,
          })
          .from(householdInvites)
          .where(inHousehold(db, householdInvites, activeInvite(new Date())))
      : []
  return { household, members, invites }
}

function activeInvite(now: Date) {
  return and(
    isNull(householdInvites.revokedAt),
    isNull(householdInvites.acceptedAt),
    gt(householdInvites.expiresAt, now),
  )!
}

export async function createInvite(
  db: HouseholdDatabase,
  actor: HouseholdActor,
  email: string,
  now = new Date(),
) {
  await requireOwner(db, actor)
  email = normalizeEmail(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error('Enter a valid email address')
  const existing = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(householdMembers, eq(user.id, householdMembers.memberId))
    .where(
      and(
        inHousehold(db, householdMembers),
        sql`lower(${user.email}) = ${email}`,
      ),
    )
    .get()
  if (existing || email === normalizeEmail(actor.email))
    throw new Error('This person already belongs to a Household')
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  const tokenHash = await hashToken(token)
  const id = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS)
  const [, inserted] = await db.batch([
    db
      .update(householdInvites)
      .set({ revokedAt: now })
      .where(
        inHousehold(
          db,
          householdInvites,
          and(
            eq(householdInvites.email, email),
            activeInvite(now),
            ownerGuard(db, actor.id),
          ),
        ),
      ),
    db
      .insert(householdInvites)
      .select(
        db
          .select({
            id: sql<string>`${id}`.as('id'),
            householdId: households.id,
            email: sql<string>`${email}`.as('email'),
            tokenHash: sql<string>`${tokenHash}`.as('token_hash'),
            invitedBy: sql<string>`${actor.id}`.as('invited_by'),
            expiresAt: sql<Date>`${expiresAt.getTime()}`.as('expires_at'),
            createdAt: stamp.as('created_at'),
            acceptedAt: sql<Date | null>`null`.as('accepted_at'),
            revokedAt: sql<Date | null>`null`.as('revoked_at'),
          })
          .from(households)
          .where(
            and(
              eq(households.id, db.householdId),
              ownerGuard(db, actor.id),
              sql`(select count(*) from ${householdInvites} where ${householdInvites.householdId} = ${db.householdId} and ${householdInvites.revokedAt} is null and ${householdInvites.acceptedAt} is null and ${householdInvites.expiresAt} > ${now.getTime()}) < ${MAX_INVITES}`,
            ),
          ),
      )
      .returning({ id: householdInvites.id }),
  ])
  if (!inserted.length)
    throw new Error(
      'Invitation not created. Check ownership or revoke an unused invitation.',
    )
  return { id, token, email, expiresAt }
}

export async function revokeInvite(
  db: HouseholdDatabase,
  actor: HouseholdActor,
  id: string,
) {
  await requireOwner(db, actor)
  await db
    .update(householdInvites)
    .set({ revokedAt: new Date() })
    .where(
      inHousehold(
        db,
        householdInvites,
        and(eq(householdInvites.id, id), ownerGuard(db, actor.id)),
      ),
    )
}

/** No Household details or recipient email are disclosed before email matching. */
export async function previewInvite(
  db: Database,
  actor: HouseholdActor,
  token: string,
  now = new Date(),
) {
  verified(actor)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error('Invitation is unavailable or belongs to another email')
  const invite = await db
    .select({
      id: householdInvites.id,
      householdId: households.id,
      name: households.name,
    })
    .from(householdInvites)
    .innerJoin(households, eq(households.id, householdInvites.householdId))
    .where(
      and(
        eq(householdInvites.tokenHash, await hashToken(token)),
        eq(householdInvites.email, normalizeEmail(actor.email)),
        activeInvite(now),
      ),
    )
    .get()
  if (!invite)
    throw new Error('Invitation is unavailable or belongs to another email')
  return invite
}

export async function acceptInvite(
  db: Database,
  actor: HouseholdActor,
  token: string,
  now = new Date(),
): Promise<Household> {
  const invite = await previewInvite(db, actor, token, now)
  if (await findMemberHousehold(db, actor.id))
    throw new Error(
      'You already belong to a Household. Joining never replaces your current budget.',
    )
  const [inserted] = await db.batch([
    db
      .insert(householdMembers)
      .select(
        db
          .select({
            householdId: householdInvites.householdId,
            memberId: sql<string>`${actor.id}`.as('member_id'),
            role: sql<'member'>`'member'`.as('role'),
            createdAt: stamp.as('created_at'),
          })
          .from(householdInvites)
          .where(
            and(
              eq(householdInvites.id, invite.id),
              eq(householdInvites.email, normalizeEmail(actor.email)),
              activeInvite(now),
            ),
          ),
      )
      .returning({ householdId: householdMembers.householdId }),
    db
      .update(householdInvites)
      .set({ acceptedAt: now })
      .where(
        and(
          eq(householdInvites.id, invite.id),
          activeInvite(now),
          sql`exists (select 1 from ${householdMembers} where ${householdMembers.householdId} = ${invite.householdId} and ${householdMembers.memberId} = ${actor.id})`,
        ),
      ),
  ])
  if (!inserted.length) throw new Error('Invitation is no longer available')
  return { id: invite.householdId, name: invite.name, role: 'member' }
}

export async function removeMember(
  db: HouseholdDatabase,
  actor: HouseholdActor,
  memberId: string,
) {
  await requireOwner(db, actor)
  if (memberId === actor.id)
    throw new Error('Transfer ownership before leaving your Household')
  const target = await db
    .select({ id: householdMembers.memberId })
    .from(householdMembers)
    .where(
      inHousehold(
        db,
        householdMembers,
        and(
          eq(householdMembers.memberId, memberId),
          eq(householdMembers.role, 'member'),
        ),
      ),
    )
    .get()
  if (!target) throw new Error('Choose a current Household Member')
  const targetGuard = sql`exists (select 1 from ${householdMembers} where ${householdMembers.householdId} = ${db.householdId} and ${householdMembers.memberId} = ${memberId} and ${householdMembers.role} = 'member')`
  await db.batch([
    // Revoke rather than merely relying on missing membership: a later
    // re-invitation must not resurrect old integrations.
    db
      .update(apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(
        inHousehold(
          db,
          apiTokens,
          and(
            eq(apiTokens.memberId, memberId),
            ownerGuard(db, actor.id),
            targetGuard,
          ),
        ),
      ),
    // Also invalidate any pending link issued in a race with their earlier
    // acceptance; removal must not leave an old path back into the Ledger.
    db
      .update(householdInvites)
      .set({ revokedAt: new Date() })
      .where(
        inHousehold(
          db,
          householdInvites,
          and(
            sql`${householdInvites.email} = (select lower(${user.email}) from ${user} where ${user.id} = ${memberId})`,
            ownerGuard(db, actor.id),
            targetGuard,
          ),
        ),
      ),
    db
      .delete(householdMembers)
      .where(
        inHousehold(
          db,
          householdMembers,
          and(
            eq(householdMembers.memberId, memberId),
            eq(householdMembers.role, 'member'),
            ownerGuard(db, actor.id),
          ),
        ),
      ),
  ])
}

export async function transferOwnership(
  db: HouseholdDatabase,
  actor: HouseholdActor,
  memberId: string,
) {
  await requireOwner(db, actor)
  if (memberId === actor.id) throw new Error('Choose another Household Member')
  const [promoted] = await db.batch([
    db
      .update(householdMembers)
      .set({ role: 'owner' })
      .where(
        inHousehold(
          db,
          householdMembers,
          and(
            eq(householdMembers.memberId, memberId),
            eq(householdMembers.role, 'member'),
            ownerGuard(db, actor.id),
          ),
        ),
      )
      .returning({ memberId: householdMembers.memberId }),
    db
      .update(householdMembers)
      .set({ role: 'member' })
      .where(
        inHousehold(
          db,
          householdMembers,
          and(
            eq(householdMembers.memberId, actor.id),
            sql`exists (select 1 from household_members as successor where successor.household_id = ${db.householdId} and successor.member_id = ${memberId} and successor.role = 'owner')`,
          ),
        ),
      ),
  ])
  if (!promoted.length) throw new Error('Choose a current Household Member')
}
