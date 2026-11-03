/**
 * SimpleFIN Bridge connections for a Household (docs/adr/0010): connect with
 * a one-time setup token, discover its accounts, and map each one to a Budgy
 * Account. Discovery imports nothing; syncing mapped accounts is sync.ts.
 */
import { and, count, eq, sql } from 'drizzle-orm'
import {
  connectionKeyReady,
  currentKey,
  encryptAccess,
  openAccess,
} from './crypto'
import {
  SimplefinError,
  claimSimplefin,
  fetchSimplefin,
} from './simplefinClient'
import type { BankKeys } from './crypto'
import type { SimplefinAccount } from './simplefinClient'
import type { HouseholdDatabase } from '@/lib/households/scope'
import { hashToken } from '@/lib/agents/tokens'
import { bankAccounts, bankConnections } from '@/lib/db/schema'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { findAccount } from '@/lib/ledger/accounts'
import { householdTimeZone } from '@/lib/households/locale'
import { today } from '@/lib/model/dates'
import { UserError } from '@/lib/errors'

/** One Bridge connection covers many banks; a few is plenty. */
export const MAX_CONNECTIONS = 5
/** Bridge asks clients to stay under 24 requests a day per connection. */
const DAILY_REQUESTS = 20
const NOT_CONFIGURED =
  'Bank connections aren’t set up on this Budgy server yet (BANK_CONNECTION_KEY).'

/** Ciphertext opens only for the Household and connection it was made for. */
const context = (db: HouseholdDatabase, id: string) =>
  `simplefin:${db.householdId}:${id}`

export async function connectSimplefin(
  db: HouseholdDatabase,
  member: { email: string },
  input: { name: string; setupToken: string },
  secret: BankKeys,
  transport: typeof fetch = fetch,
): Promise<{ id: string }> {
  // A setup token works once: don't spend it unless it can be stored.
  if (!connectionKeyReady(currentKey(secret)))
    throw new UserError(NOT_CONFIGURED)
  const [{ connected }] = await db
    .select({ connected: count() })
    .from(bankConnections)
    .where(inHousehold(db, bankConnections))
  if (connected >= MAX_CONNECTIONS)
    throw new UserError(
      `A Household can have ${MAX_CONNECTIONS} bank connections. Disconnect one you no longer use.`,
    )
  const access = await claimSimplefin(input.setupToken, transport)
  const accessHash = await hashToken(access)
  const taken = await db
    .select({ id: bankConnections.id })
    .from(bankConnections)
    .where(eq(bankConnections.accessHash, accessHash))
    .get()
  if (taken) throw new UserError('This SimpleFIN access is already connected.')
  const id = crypto.randomUUID()
  await db.insert(bankConnections).values(
    householdRow(db, {
      id,
      name: input.name,
      createdBy: member.email,
      encryptedAccess: await encryptAccess(
        access,
        currentKey(secret),
        context(db, id),
      ),
      accessHash,
      status: 'ready' as const,
    }),
  )
  try {
    await discoverAccounts(db, id, secret, transport)
  } catch {
    // Saved as needing attention; the Member can retry discovery.
  }
  return { id }
}

/** Count a Bridge request against today's allowance, or refuse it. */
async function spendRequest(db: HouseholdDatabase, id: string) {
  const day = today(await householdTimeZone(db))
  const spent = await db
    .update(bankConnections)
    .set({
      requestDay: day,
      requestCount: sql`case when ${bankConnections.requestDay} = ${day} then ${bankConnections.requestCount} + 1 else 1 end`,
    })
    .where(
      inHousehold(
        db,
        bankConnections,
        and(
          eq(bankConnections.id, id),
          sql`(${bankConnections.requestDay} is not ${day} or ${bankConnections.requestCount} < ${DAILY_REQUESTS})`,
        ),
      ),
    )
    .returning({ id: bankConnections.id })
  if (!spent.length)
    throw new UserError(
      'This connection has reached today’s SimpleFIN request limit. Try again tomorrow.',
    )
}

/** Refresh the list of accounts Bridge shares, with no transactions. */
export async function discoverAccounts(
  db: HouseholdDatabase,
  id: string,
  secret: BankKeys,
  transport: typeof fetch = fetch,
): Promise<void> {
  await readBridge(db, id, secret, { balancesOnly: true }, transport)
}

/**
 * One request to Bridge for a connection, within its daily allowance. What
 * it lists refreshes the discovered accounts; a failure marks the connection
 * as needing attention, with a safe message.
 */
export async function readBridge(
  db: HouseholdDatabase,
  id: string,
  secret: BankKeys,
  options: Parameters<typeof fetchSimplefin>[1],
  transport: typeof fetch = fetch,
): Promise<Array<SimplefinAccount>> {
  const connection = await db
    .select()
    .from(bankConnections)
    .where(inHousehold(db, bankConnections, eq(bankConnections.id, id)))
    .get()
  if (!connection) throw new UserError('That bank connection no longer exists.')
  if (!connectionKeyReady(currentKey(secret)))
    throw new UserError(NOT_CONFIGURED)
  await spendRequest(db, id)
  let found: Awaited<ReturnType<typeof fetchSimplefin>>
  try {
    const { access, resealed } = await openAccess(
      connection.encryptedAccess,
      secret,
      context(db, id),
    )
    // Opened with the previous key during a rotation: store it under the
    // current one, so the previous key can be retired.
    if (resealed)
      await db
        .update(bankConnections)
        .set({ encryptedAccess: resealed })
        .where(inHousehold(db, bankConnections, eq(bankConnections.id, id)))
    found = await fetchSimplefin(access, options, transport)
  } catch (error) {
    const message =
      error instanceof SimplefinError
        ? error.message
        : 'This connection’s credentials couldn’t be opened. Disconnect it and connect again.'
    await db
      .update(bankConnections)
      .set({ status: 'attention', lastError: message })
      .where(inHousehold(db, bankConnections, eq(bankConnections.id, id)))
    throw error instanceof SimplefinError ? error : new UserError(message)
  }
  const statements = found.accounts.map((a) =>
    db
      .insert(bankAccounts)
      .values(
        householdRow(db, {
          connectionId: id,
          providerId: a.id,
          name: a.name,
          institution: a.institution,
          currency: a.currency,
          present: true,
        }),
      )
      .onConflictDoUpdate({
        target: [
          bankAccounts.householdId,
          bankAccounts.connectionId,
          bankAccounts.providerId,
        ],
        set: {
          name: a.name,
          institution: a.institution,
          currency: a.currency,
          present: true,
        },
      }),
  )
  // Everything is absent until Bridge lists it again; mappings are kept.
  await db.batch([
    db
      .update(bankAccounts)
      .set({ present: false })
      .where(inHousehold(db, bankAccounts, eq(bankAccounts.connectionId, id))),
    ...statements,
    db
      .update(bankConnections)
      .set({
        status: found.problems.length ? 'attention' : 'ready',
        lastError: found.problems.length
          ? `SimpleFIN says: ${found.problems.join(' ')} Check your connections in SimpleFIN Bridge.`
          : null,
        lastFetchedAt: new Date(),
      })
      .where(inHousehold(db, bankConnections, eq(bankConnections.id, id))),
  ])
  return found.accounts
}

/**
 * Feed a discovered account into a Budgy Account, or stop (null). Card and
 * bank Accounts get purchases and balances; others (investments, loans) get
 * balances only.
 */
export async function mapBankAccount(
  db: HouseholdDatabase,
  input: { connectionId: string; providerId: string; account: string | null },
): Promise<void> {
  const where = inHousehold(
    db,
    bankAccounts,
    and(
      eq(bankAccounts.connectionId, input.connectionId),
      eq(bankAccounts.providerId, input.providerId),
    ),
  )
  const found = await db.select().from(bankAccounts).where(where).get()
  if (!found) throw new UserError('That bank account no longer exists.')
  let name: string | null = null
  if (input.account !== null) {
    const account = await findAccount(db, input.account)
    if (account.closed) throw new UserError('Reopen this account to link it.')
    if (found.currency.toUpperCase() !== 'USD')
      throw new UserError('Budgy only supports USD accounts.')
    const linked = await db
      .select({
        name: bankAccounts.name,
        connectionId: bankAccounts.connectionId,
        providerId: bankAccounts.providerId,
      })
      .from(bankAccounts)
      .where(
        inHousehold(db, bankAccounts, eq(bankAccounts.account, account.name)),
      )
      .get()
    if (
      linked &&
      (linked.connectionId !== found.connectionId ||
        linked.providerId !== found.providerId)
    )
      throw new UserError(
        `${account.name} is already linked to ${linked.name}.`,
      )
    name = account.name
  }
  await db.update(bankAccounts).set({ account: name }).where(where)
}

/** Forget a connection and its credential. Revoking it in Bridge is separate. */
export async function disconnectSimplefin(
  db: HouseholdDatabase,
  id: string,
): Promise<void> {
  await db.batch([
    db
      .delete(bankAccounts)
      .where(inHousehold(db, bankAccounts, eq(bankAccounts.connectionId, id))),
    db
      .delete(bankConnections)
      .where(inHousehold(db, bankConnections, eq(bankConnections.id, id))),
  ])
}

/** Connections and their accounts, never the credential. */
export async function listConnections(db: HouseholdDatabase) {
  const [connections, discovered] = await Promise.all([
    db
      .select({
        id: bankConnections.id,
        name: bankConnections.name,
        createdBy: bankConnections.createdBy,
        status: bankConnections.status,
        lastError: bankConnections.lastError,
        lastFetchedAt: bankConnections.lastFetchedAt,
        createdAt: bankConnections.createdAt,
      })
      .from(bankConnections)
      .where(inHousehold(db, bankConnections))
      .orderBy(bankConnections.createdAt),
    db
      .select({
        connectionId: bankAccounts.connectionId,
        providerId: bankAccounts.providerId,
        name: bankAccounts.name,
        institution: bankAccounts.institution,
        currency: bankAccounts.currency,
        account: bankAccounts.account,
        present: bankAccounts.present,
        syncedThrough: bankAccounts.syncedThrough,
      })
      .from(bankAccounts)
      .where(inHousehold(db, bankAccounts))
      .orderBy(bankAccounts.institution, bankAccounts.name),
  ])
  return connections.map((c) => ({
    ...c,
    accounts: discovered.filter((a) => a.connectionId === c.id),
  }))
}
