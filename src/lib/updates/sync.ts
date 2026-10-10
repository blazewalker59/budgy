/**
 * Syncing SimpleFIN accounts into the Budgy Accounts they're mapped to
 * (docs/adr/0010). One Bridge request per connection covers every account:
 * posted purchases go through the shared ingestion path with stable source
 * IDs, so overlapping windows never add a purchase twice, and each account's
 * balance is recorded. Pending transactions wait until they post.
 */
import { and, eq, isNotNull } from 'drizzle-orm'
import { readBridge } from './connections'
import { isSpending } from './exports'
import type { SimplefinTransaction } from './simplefinClient'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { PostedRow } from '@/lib/import/posted'
import { dbFromD1 } from '@/lib/db'
import { bankAccounts, bankConnections } from '@/lib/db/schema'
import { householdDatabase, inHousehold } from '@/lib/households/scope'
import {
  findAccount,
  postTransactions,
  recordBalances,
} from '@/lib/ledger/accounts'
import { addDays, dateOn, today } from '@/lib/model/dates'
import { isDebt } from '@/lib/model/accounts'

/** How far a first sync reaches back. */
const FIRST_DAYS = 45
/** Each sync re-reads this many days, for late-posting purchases. */
const OVERLAP_DAYS = 10
/** Never ask Bridge for more than this, however long since the last sync. */
const MAX_DAYS = 60
const SPENDING_KINDS = ['credit', 'checking', 'savings']

export interface SyncedAccount {
  account: string
  added?: number
  balance?: boolean
  error?: string
}

const day = (seconds: number) => dateOn(new Date(seconds * 1000))

/** A posted SimpleFIN transaction as a purchase row, or null if it isn't one. */
function purchaseRow(
  t: SimplefinTransaction,
  debt: boolean,
): PostedRow | 'excluded' | null {
  if (t.pending || !t.posted) return null
  // SimpleFIN amounts are negative for money out; Budgy's are positive.
  const cents = -Math.round(Number(t.amount) * 100)
  const description = t.description.slice(0, 200) || 'Unnamed purchase'
  if (!isSpending(cents, description, '', debt)) return 'excluded'
  return {
    date: day(t.transactedAt ?? t.posted),
    description,
    amount: cents / 100,
    sourceId: t.id,
  }
}

export async function syncConnection(
  db: HouseholdDatabase,
  id: string,
  secret: string | undefined,
  transport: typeof fetch = fetch,
): Promise<Array<SyncedAccount>> {
  const mapped = await db
    .select()
    .from(bankAccounts)
    .where(
      inHousehold(
        db,
        bankAccounts,
        and(eq(bankAccounts.connectionId, id), isNotNull(bankAccounts.account)),
      ),
    )
  if (!mapped.length)
    throw new Error('Link a bank account to a Budgy account first.')
  const until = today()
  const from = mapped
    .map((m) =>
      m.syncedThrough
        ? addDays(m.syncedThrough, -OVERLAP_DAYS)
        : addDays(until, -FIRST_DAYS),
    )
    .reduce((a, b) => (a < b ? a : b))
  const start = [from, addDays(until, -MAX_DAYS)].sort().at(-1)!
  const found = await readBridge(
    db,
    id,
    secret,
    // A day early, so no time zone drops the first day's purchases.
    { start: Date.parse(`${addDays(start, -1)}T00:00:00Z`) / 1000 },
    transport,
  )
  const connection = await db
    .select({ name: bankConnections.name })
    .from(bankConnections)
    .where(inHousehold(db, bankConnections, eq(bankConnections.id, id)))
    .get()
  const by = `SimpleFIN (${connection?.name ?? 'connection'})`

  const results: Array<SyncedAccount> = []
  for (const m of mapped) {
    const accountName = m.account!
    const source = found.find((a) => a.id === m.providerId)
    if (!source) {
      results.push({
        account: accountName,
        error: `SimpleFIN no longer shares ${m.name}.`,
      })
      continue
    }
    try {
      const account = await findAccount(db, accountName)
      if (account.closed) continue
      const debt = isDebt(account)
      const result: SyncedAccount = { account: account.name }
      if (SPENDING_KINDS.includes(account.kind)) {
        const rows: Array<PostedRow> = []
        let excluded = 0
        for (const t of source.transactions) {
          const row = purchaseRow(t, debt)
          if (row === 'excluded') excluded++
          else if (row) rows.push(row)
        }
        const summary = await postTransactions(db, {
          account: account.name,
          rows,
          commit: true,
          importedBy: by,
          via: 'simplefin',
          sourceNamespace: `simplefin:${m.providerId}`,
          excluded,
          coverage: { from: start, to: until },
        })
        result.added = summary.added
      }
      // SimpleFIN shows what's owed as negative; Budgy as positive.
      const cents = Math.round(Number(source.balance) * 100)
      await recordBalances(
        db,
        [
          {
            account: account.name,
            date: source.balanceDate ? day(source.balanceDate) : until,
            amount: debt ? -cents : cents,
          },
        ],
        by,
      )
      result.balance = true
      await db
        .update(bankAccounts)
        .set({ syncedThrough: until })
        .where(
          inHousehold(
            db,
            bankAccounts,
            and(
              eq(bankAccounts.connectionId, id),
              eq(bankAccounts.providerId, m.providerId),
            ),
          ),
        )
      results.push(result)
    } catch (error) {
      results.push({
        account: accountName,
        error:
          error instanceof Error && !error.message.startsWith('Failed query')
            ? error.message
            : 'This sync didn’t finish. Budgy will try again.',
      })
    }
  }
  return results
}

/**
 * The scheduled sync: every connection with a mapped account, in every
 * Household. A trusted background job, so each runs in its own Household's
 * scope; one failing doesn't stop the rest.
 */
export async function syncAll(
  d1: D1Database,
  secret: string | undefined,
  transport: typeof fetch = fetch,
): Promise<void> {
  const due = await dbFromD1(d1)
    .selectDistinct({
      id: bankAccounts.connectionId,
      householdId: bankAccounts.householdId,
    })
    .from(bankAccounts)
    .where(isNotNull(bankAccounts.account))
  for (const connection of due) {
    try {
      await syncConnection(
        // A client is bound to one Household, so each gets its own.
        householdDatabase(dbFromD1(d1), connection.householdId),
        connection.id,
        secret,
        transport,
      )
    } catch (error) {
      console.error(
        `SimpleFIN sync failed for connection ${connection.id}:`,
        error instanceof Error ? error.message : 'unknown error',
      )
    }
  }
}
