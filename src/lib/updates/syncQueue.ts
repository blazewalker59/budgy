/**
 * Scheduled SimpleFIN sync on a Cloudflare Queue (docs/adr/0012). The cron
 * only enqueues one message per linked connection; the consumer syncs each
 * in its own invocation and Household scope, so one Household's connections
 * never use up another's D1 queries or CPU time, and one failing doesn't
 * stop the rest. A message names a Household and connection, nothing more:
 * the credential stays encrypted in D1.
 */
import { and, eq, isNotNull, isNull, lt, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { syncConnection } from './sync'
import { SimplefinError } from './simplefinClient'
import type { BankKeys } from './crypto'
import type { HouseholdDatabase } from '@/lib/households/scope'
import { dbFromD1 } from '@/lib/db'
import { bankAccounts, bankConnections } from '@/lib/db/schema'
import { householdDatabase, inHousehold } from '@/lib/households/scope'
import { errorCode, isUserError } from '@/lib/errors'

export interface SyncMessage {
  householdId: string
  connectionId: string
}

const syncMessage = z
  .object({
    householdId: z.string().min(1).max(64),
    connectionId: z.string().min(1).max(64),
  })
  .strict()

/** Attempts per message, counting the first. Each spends a Bridge request. */
export const MAX_ATTEMPTS = 3
/** Wait longer after each failed attempt: 10, then 20 minutes. */
const RETRY_DELAY_SECONDS = 600
/** Cloudflare's limit for one sendBatch call. */
const SEND_BATCH = 100

/**
 * How long after linking an account its first sync runs. Accounts linked
 * one after another within it share one sync (docs/adr/0014).
 */
export const FIRST_SYNC_DELAY_SECONDS = 30

/**
 * A Member linked accounts: queue each connection's sync, which reads
 * back their history, rather than make the Member wait for it. Linking
 * still succeeds if this can't (no queue locally, say); the next scheduled
 * sync reads them then.
 */
export async function queueFirstSync(
  db: HouseholdDatabase,
  connectionIds: Iterable<string>,
  queue: Queue<SyncMessage> | undefined,
): Promise<number> {
  if (!queue) return 0
  let queued = 0
  for (const connectionId of new Set(connectionIds)) {
    try {
      const now = new Date()
      const claimed = await db
        .update(bankConnections)
        .set({
          syncQueuedUntil: new Date(
            now.getTime() + FIRST_SYNC_DELAY_SECONDS * 1000,
          ),
        })
        .where(
          inHousehold(
            db,
            bankConnections,
            and(
              eq(bankConnections.id, connectionId),
              or(
                isNull(bankConnections.syncQueuedUntil),
                lt(bankConnections.syncQueuedUntil, now),
              ),
            ),
          ),
        )
        .returning({ id: bankConnections.id })
      if (!claimed.length) continue
      await queue.send(
        { householdId: db.householdId, connectionId },
        { delaySeconds: FIRST_SYNC_DELAY_SECONDS },
      )
      queued++
    } catch (error) {
      console.error('SimpleFIN first sync not queued:', errorCode(error))
    }
  }
  return queued
}

/**
 * The cron: one message per connection with a linked account. A revoked
 * one is left alone: only a new setup token can fix it, and asking again
 * with refused credentials only spends Bridge's patience. A lapsed
 * subscription is still asked, so syncing resumes on its own once renewed.
 */
export async function enqueueSyncs(
  d1: D1Database,
  queue: Queue<SyncMessage>,
): Promise<number> {
  const due = await dbFromD1(d1)
    .selectDistinct({
      householdId: bankAccounts.householdId,
      connectionId: bankAccounts.connectionId,
    })
    .from(bankAccounts)
    .innerJoin(
      bankConnections,
      and(
        eq(bankConnections.householdId, bankAccounts.householdId),
        eq(bankConnections.id, bankAccounts.connectionId),
      ),
    )
    .where(
      and(
        isNotNull(bankAccounts.account),
        ne(bankConnections.status, 'revoked'),
      ),
    )
  for (let i = 0; i < due.length; i += SEND_BATCH)
    await queue.sendBatch(
      due.slice(i, i + SEND_BATCH).map((body) => ({ body })),
    )
  return due.length
}

/**
 * What became of one message: synced (or nothing to do), not worth another
 * try, or worth one after a wait.
 */
export type SyncOutcome = 'synced' | 'dropped' | 'retry'

export async function syncMessageBody(
  d1: D1Database,
  body: unknown,
  keys: BankKeys,
  transport: typeof fetch = fetch,
): Promise<SyncOutcome> {
  const parsed = syncMessage.safeParse(body)
  if (!parsed.success) {
    console.error('SimpleFIN sync: malformed queue message')
    return 'dropped'
  }
  const { householdId, connectionId } = parsed.data
  const db = householdDatabase(dbFromD1(d1), householdId)
  // Disconnected or unlinked since it was enqueued: nothing to sync.
  const linked = await db
    .select({ id: bankConnections.id })
    .from(bankConnections)
    .innerJoin(
      bankAccounts,
      and(
        eq(bankAccounts.householdId, bankConnections.householdId),
        eq(bankAccounts.connectionId, bankConnections.id),
      ),
    )
    .where(
      inHousehold(
        db,
        bankConnections,
        and(
          eq(bankConnections.id, connectionId),
          isNotNull(bankAccounts.account),
        ),
      ),
    )
    .get()
  if (!linked) return 'dropped'
  try {
    await syncConnection(db, connectionId, keys, transport)
    return 'synced'
  } catch (error) {
    console.error(
      `SimpleFIN sync failed for connection ${connectionId}:`,
      error instanceof SimplefinError
        ? `simplefin:${error.kind}`
        : errorCode(error),
    )
    // Bridge unreachable, or a database hiccup: worth another try. A Member's
    // problem (revoked access, today's request limit, no key) is not; the
    // connection already shows it, and the next cron tries again.
    const transient =
      error instanceof SimplefinError
        ? error.kind === 'network'
        : !isUserError(error)
    return transient ? 'retry' : 'dropped'
  }
}

/** The queue consumer: each message on its own, acked or retried. */
export async function consumeSyncBatch(
  d1: D1Database,
  batch: MessageBatch<unknown>,
  keys: BankKeys,
  transport: typeof fetch = fetch,
): Promise<void> {
  for (const message of batch.messages) {
    let outcome: SyncOutcome
    try {
      outcome = await syncMessageBody(d1, message.body, keys, transport)
    } catch (error) {
      console.error('SimpleFIN sync message failed:', errorCode(error))
      outcome = 'retry'
    }
    if (outcome === 'retry' && message.attempts < MAX_ATTEMPTS)
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS * message.attempts })
    else message.ack()
  }
}
