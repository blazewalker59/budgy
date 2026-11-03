/**
 * The demo sandbox (docs/adr/0015): Demo personas, an admin acting as one,
 * and putting a persona back to the start. Server-only.
 *
 * Every write that could touch real data carries its own SQL predicate:
 * personas must be synthetic `demo.invalid` users, and resets delete only
 * rows of a Household whose `demo` flag is set. Triggers (0021) back these
 * up in the database itself.
 */
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm'
import {
  LABEL_PATTERN,
  MAX_LABEL,
  MAX_PERSONAS,
  personaEmail,
  personaName,
} from './personas'
import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Database } from '@/lib/db'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { StepState } from '@/lib/model/setup'
import {
  account,
  accountInputs,
  accountLabels,
  accountUpdateLocks,
  accountUpdates,
  accounts,
  adminAudit,
  apiTokens,
  balances,
  bankAccounts,
  bankConnections,
  budgetTargets,
  categories,
  demoPersonas,
  demoSessions,
  householdInvites,
  householdMembers,
  households,
  imports,
  moneyIn,
  paySchedules,
  plannedExpenses,
  savedLenses,
  settings,
  storeRules,
  transactions,
  uploadTokens,
  user,
} from '@/lib/db/schema'
import { createInvite } from '@/lib/households/service'
import { parseOwners, validTimeZone } from '@/lib/households/locale'
import { loadLedger } from '@/lib/ledger/queries'
import { indexLedger } from '@/lib/model/ledger'
import { today } from '@/lib/model/dates'
import { setupProgress } from '@/lib/model/setup'
import { randomToken } from '@/lib/secret'
import { UserError } from '@/lib/errors'

/**
 * Every table holding a Household's rows, besides `households` itself. A
 * test compares this with the migrated database, so a new table with a
 * `household_id` can't be left out of a reset.
 */
export const DEMO_HOUSEHOLD_TABLES: ReadonlyArray<
  SQLiteTable & { householdId: SQLiteColumn }
> = [
  householdMembers,
  householdInvites,
  categories,
  accounts,
  accountLabels,
  balances,
  transactions,
  accountUpdates,
  accountUpdateLocks,
  accountInputs,
  storeRules,
  budgetTargets,
  plannedExpenses,
  paySchedules,
  savedLenses,
  imports,
  settings,
  apiTokens,
  uploadTokens,
  bankAccounts,
  bankConnections,
  moneyIn,
]

export interface Persona {
  id: string
  label: string
  name: string
  email: string
}

const stamp = sql`cast(unixepoch('subsecond') * 1000 as integer)`

/** A synthetic demo user that can't sign in: what every persona must be. */
const synthetic = (id: SQLiteColumn | SQL) =>
  sql`exists (select 1 from ${user} where ${user.id} = ${id} and lower(${user.email}) like '%@demo.invalid') and not exists (select 1 from ${account} where ${account.userId} = ${id})`

/** Only a Demo Household's rows. */
const inDemoHousehold = (column: SQLiteColumn) =>
  sql`${column} in (select ${households.id} from ${households} where ${households.demo} = 1)`

function audit(
  db: Database,
  adminId: string,
  action: string,
  personaId: string | null,
) {
  return db.insert(adminAudit).values({ adminId, action, personaId })
}

function randomSuffix() {
  return randomToken(12)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
}

export async function createPersona(
  db: Database,
  adminId: string,
  label: string,
): Promise<Persona> {
  label = label.trim()
  if (!label || label.length > MAX_LABEL || !LABEL_PATTERN.test(label))
    throw new UserError(
      `Name the persona (letters, numbers and spaces, up to ${MAX_LABEL})`,
    )
  const existing = await db.select({ n: count() }).from(demoPersonas).get()
  if ((existing?.n ?? 0) >= MAX_PERSONAS)
    throw new UserError('Delete a persona before making another')
  const id = `demo_${crypto.randomUUID().replaceAll('-', '')}`
  const persona = {
    id,
    label,
    name: personaName(label),
    email: personaEmail(label, randomSuffix()),
  }
  await db.batch([
    db.insert(user).values({
      id,
      name: persona.name,
      email: persona.email,
      emailVerified: true,
    }),
    // The trigger refuses this for anything but the synthetic user above.
    db.insert(demoPersonas).values({ id, label, createdBy: adminId }),
    audit(db, adminId, 'create persona', id),
  ])
  return persona
}

/** The persona this admin session is acting as, if it still may. */
export async function actingPersona(
  db: Database,
  sessionId: string | null,
  adminId: string,
  admin: boolean,
): Promise<Persona | null> {
  if (!sessionId) return null
  const row = await db
    .select({
      id: user.id,
      label: demoPersonas.label,
      name: user.name,
      email: user.email,
    })
    .from(demoSessions)
    .innerJoin(demoPersonas, eq(demoPersonas.id, demoSessions.personaId))
    .innerJoin(user, eq(user.id, demoPersonas.id))
    .where(
      and(
        eq(demoSessions.sessionId, sessionId),
        eq(demoSessions.adminId, adminId),
        synthetic(user.id),
      ),
    )
    .get()
  if (!row) return null
  // No longer an admin: the demo ends now, not when they next sign out.
  if (!admin) {
    await endDemo(db, sessionId)
    return null
  }
  return row
}

export async function endDemo(db: Database, sessionId: string) {
  await db.delete(demoSessions).where(eq(demoSessions.sessionId, sessionId))
}

export async function startDemo(
  db: Database,
  sessionId: string,
  adminId: string,
  personaId: string,
) {
  const [, started] = await db.batch([
    db.delete(demoSessions).where(eq(demoSessions.sessionId, sessionId)),
    db
      .insert(demoSessions)
      .select(
        db
          .select({
            sessionId: sql<string>`${sessionId}`.as('session_id'),
            adminId: sql<string>`${adminId}`.as('admin_id'),
            personaId: demoPersonas.id,
            createdAt: stamp.as('created_at'),
          })
          .from(demoPersonas)
          .where(
            and(eq(demoPersonas.id, personaId), synthetic(demoPersonas.id)),
          ),
      )
      .returning({ personaId: demoSessions.personaId }),
    audit(db, adminId, 'act as', personaId),
  ])
  if (!started.length) throw new UserError('That isn’t a demo persona')
}

export async function stopDemo(
  db: Database,
  sessionId: string,
  adminId: string,
) {
  await db.batch([
    db
      .delete(demoSessions)
      .where(
        and(
          eq(demoSessions.sessionId, sessionId),
          eq(demoSessions.adminId, adminId),
        ),
      ),
    audit(db, adminId, 'exit demo', null),
  ])
}

async function requirePersona(db: Database, personaId: string) {
  const persona = await db
    .select({
      id: user.id,
      label: demoPersonas.label,
      name: user.name,
      email: user.email,
    })
    .from(demoPersonas)
    .innerJoin(user, eq(user.id, demoPersonas.id))
    .where(and(eq(demoPersonas.id, personaId), synthetic(demoPersonas.id)))
    .get()
  if (!persona) throw new UserError('That isn’t a demo persona')
  return persona
}

async function personaMembership(db: Database, personaId: string) {
  return db
    .select({
      householdId: householdMembers.householdId,
      role: householdMembers.role,
      demo: households.demo,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.memberId, personaId))
    .get()
}

/**
 * Delete a Demo Household and every row it has, in one batch. Each delete
 * names the Household and requires its demo flag in SQL, so a real
 * Household's id deletes nothing.
 */
export async function deleteDemoHousehold(db: Database, householdId: string) {
  const [first, ...rest] = DEMO_HOUSEHOLD_TABLES.map((table) =>
    db
      .delete(table)
      .where(
        and(
          eq(table.householdId, householdId),
          inDemoHousehold(table.householdId),
        ),
      ),
  )
  await db.batch([
    first,
    ...rest,
    db
      .delete(households)
      .where(and(eq(households.id, householdId), eq(households.demo, true))),
  ])
}

/** A persona who joined someone's Demo Household leaves it, with their tokens. */
async function leaveDemoHousehold(
  db: Database,
  householdId: string,
  persona: Persona,
) {
  const mine = (table: SQLiteTable & { householdId: SQLiteColumn }) =>
    and(eq(table.householdId, householdId), inDemoHousehold(table.householdId))
  await db.batch([
    db
      .delete(apiTokens)
      .where(and(mine(apiTokens), eq(apiTokens.memberId, persona.id))),
    db
      .delete(uploadTokens)
      .where(and(mine(uploadTokens), eq(uploadTokens.memberId, persona.id))),
    db
      .delete(householdInvites)
      .where(
        and(
          mine(householdInvites),
          eq(householdInvites.email, persona.email.toLowerCase()),
        ),
      ),
    db
      .delete(householdMembers)
      .where(
        and(
          mine(householdMembers),
          eq(householdMembers.memberId, persona.id),
          eq(householdMembers.role, 'member'),
        ),
      ),
  ])
}

/**
 * Back to the start: no Household. An owner's Household is deleted with
 * everything in it (any persona who joined it starts over too); a persona
 * who joined one leaves it.
 */
export async function resetPersona(
  db: Database,
  adminId: string,
  personaId: string,
) {
  const persona = await requirePersona(db, personaId)
  const membership = await personaMembership(db, persona.id)
  if (membership && !membership.demo)
    // The membership trigger makes this impossible; refuse all the same.
    throw new Error('A demo persona is in a Household that is not a demo')
  if (membership?.role === 'owner')
    await deleteDemoHousehold(db, membership.householdId)
  else if (membership)
    await leaveDemoHousehold(db, membership.householdId, persona)
  await audit(db, adminId, 'reset persona', persona.id)
}

export async function deletePersona(
  db: Database,
  adminId: string,
  personaId: string,
) {
  await resetPersona(db, adminId, personaId)
  // Its demo row and any admin's demo session as it go with the user.
  await db.batch([
    db
      .delete(user)
      .where(
        and(
          eq(user.id, personaId),
          sql`exists (select 1 from ${demoPersonas} where ${demoPersonas.id} = ${user.id})`,
          synthetic(user.id),
        ),
      ),
    audit(db, adminId, 'delete persona', personaId),
  ])
}

/**
 * A new persona invited into `fromPersonaId`'s Household, through the same
 * createInvite a real owner uses. The link is returned this once.
 */
export async function replayInvite(
  db: Database,
  scope: (householdId: string) => HouseholdDatabase,
  adminId: string,
  fromPersonaId: string,
  label: string,
) {
  const from = await requirePersona(db, fromPersonaId)
  const membership = await personaMembership(db, from.id)
  if (!membership?.demo || membership.role !== 'owner')
    throw new UserError(`${from.name} needs a Household of their own first`)
  const persona = await createPersona(db, adminId, label)
  const invite = await createInvite(
    scope(membership.householdId),
    { id: from.id, email: from.email, emailVerified: true, demo: true },
    persona.email,
  )
  await audit(db, adminId, 'replay invite', persona.id)
  return { persona, path: `/join/${invite.token}` }
}

export interface PersonaSummary extends Persona {
  createdAt: number
  acting: boolean
  household: {
    name: string
    role: 'owner' | 'member'
    members: number
    invites: number
    purchases: number
    accounts: number
    bankConnections: number
    steps: Array<StepState>
  } | null
}

/**
 * Every persona, with its Demo Household and setup progress: counts of the
 * persona's own demo data only. Nothing is read from a real Household.
 */
export async function listPersonas(
  db: Database,
  scope: (householdId: string) => HouseholdDatabase,
  sessionId: string,
): Promise<Array<PersonaSummary>> {
  const rows = await db
    .select({
      id: user.id,
      label: demoPersonas.label,
      name: user.name,
      email: user.email,
      createdAt: demoPersonas.createdAt,
      householdId: households.id,
      householdName: households.name,
      timeZone: households.timeZone,
      owners: households.owners,
      role: householdMembers.role,
      acting: sql<number>`exists (select 1 from ${demoSessions} where ${demoSessions.sessionId} = ${sessionId} and ${demoSessions.personaId} = ${demoPersonas.id})`,
    })
    .from(demoPersonas)
    .innerJoin(user, eq(user.id, demoPersonas.id))
    .leftJoin(householdMembers, eq(householdMembers.memberId, demoPersonas.id))
    .leftJoin(
      households,
      and(
        eq(households.id, householdMembers.householdId),
        eq(households.demo, true),
      ),
    )
    .where(synthetic(demoPersonas.id))
    .orderBy(demoPersonas.createdAt)
  const progress = new Map<string, PersonaSummary['household']>()
  const now = new Date()
  for (const row of rows) {
    if (!row.householdId || progress.has(row.householdId)) continue
    const id = row.householdId
    const [members, invites, connections] = await Promise.all([
      db
        .select({ n: count() })
        .from(householdMembers)
        .where(eq(householdMembers.householdId, id))
        .get(),
      db
        .select({ n: count() })
        .from(householdInvites)
        .where(
          and(
            eq(householdInvites.householdId, id),
            isNull(householdInvites.revokedAt),
            isNull(householdInvites.acceptedAt),
            gt(householdInvites.expiresAt, now),
          ),
        )
        .get(),
      db
        .select({ n: count() })
        .from(bankConnections)
        .where(eq(bankConnections.householdId, id))
        .get(),
    ])
    const ledger = await loadLedger(scope(id))
    const facts = {
      owners: parseOwners(row.owners),
      members: members?.n ?? 0,
      invites: invites?.n ?? 0,
    }
    progress.set(id, {
      name: row.householdName ?? '',
      role: 'owner',
      members: facts.members,
      invites: facts.invites,
      purchases: ledger.txns.length,
      accounts: ledger.accounts.length,
      bankConnections: connections?.n ?? 0,
      steps: setupProgress(
        indexLedger(ledger),
        today(validTimeZone(row.timeZone)),
        ledger.setup,
        facts,
      ),
    })
  }
  return rows.map((row) => {
    const household = row.householdId ? progress.get(row.householdId) : null
    return {
      id: row.id,
      label: row.label,
      name: row.name,
      email: row.email,
      createdAt: row.createdAt.getTime(),
      acting: Boolean(row.acting),
      household:
        household && row.role ? { ...household, role: row.role } : null,
    }
  })
}
