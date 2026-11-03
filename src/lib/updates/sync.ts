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
import type { BankKeys } from './crypto'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { PostedRow } from '@/lib/import/posted'
import type { IncomingRow } from '@/lib/model/moneyIn'
import { recordMoneyIn } from '@/lib/moneyIn/service'
import { dbFromD1 } from '@/lib/db'
import { bankAccounts, bankConnections } from '@/lib/db/schema'
import { householdDatabase, inHousehold } from '@/lib/households/scope'
import {
  findAccount,
  postTransactions,
  recordBalances,
} from '@/lib/ledger/accounts'
import { UserError, clientMessage } from '@/lib/errors'
import { householdTimeZone } from '@/lib/households/locale'
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
  /** New Money in, for a bank Account. */
  moneyIn?: number
  balance?: boolean
  error?: string
}

/** A posted SimpleFIN transaction as a purchase row, or null if it isn't one. */
function purchaseRow(
  t: SimplefinTransaction,
  debt: boolean,
  timeZone: string,
): PostedRow | 'excluded' | null {
  if (t.pending || !t.posted) return null
  // SimpleFIN amounts are negative for money out; Budgy's are positive.
  const cents = -Math.round(Number(t.amount) * 100)
  const description = t.description.slice(0, 200) || 'Unnamed purchase'
  if (!isSpending(cents, description, '', debt)) return 'excluded'
  return {
    date: dateOn(new Date((t.transactedAt ?? t.posted) * 1000), timeZone),
    description,
    amount: cents / 100,
    sourceId: t.id,
  }
}

/** Posted money into a bank Account, as Money in (docs/adr/0011). */
function incomingRow(
  t: SimplefinTransaction,
  debt: boolean,
  timeZone: string,
): IncomingRow | null {
  if (debt || t.pending || !t.posted) return null
  const cents = Math.round(Number(t.amount) * 100)
  if (cents <= 0) return null
  return {
    date: dateOn(new Date((t.transactedAt ?? t.posted) * 1000), timeZone),
    description: t.description.slice(0, 200) || 'Money in',
    amount: cents,
    sourceId: t.id,
  }
}

export async function syncConnection(
  db: HouseholdDatabase,
  id: string,
  secret: BankKeys,
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
    throw new UserError('Link a bank account to a Budgy account first.')
  const timeZone = await householdTimeZone(db)
  const until = today(timeZone)
  const from = mapped
    .map((m) =>
      m.syncedThrough
        ? addDays(m.syncedThrough, -OVERLAP_DAYS)
        : addDays(until, -FIRST_DAYS),
    )
    .reduce((a, b) => (a < b ? a : b))
  const start = [from, addDays(until, -MAX_DAYS)].sort().at(-1)!
  // A day early, so no time zone drops the first day's purchases.
  const purchasesFrom = Date.parse(`${addDays(start, -1)}T00:00:00Z`) / 1000
  // An account not yet read for Money in reaches back the whole window once
  // (docs/adr/0011); its purchases still keep to their own window.
  const backfill = mapped.some((m) => !m.moneyInSince)
  const fetchFrom = backfill ? addDays(until, -MAX_DAYS) : start
  const found = await readBridge(
    db,
    id,
    secret,
    { start: Date.parse(`${addDays(fetchFrom, -1)}T00:00:00Z`) / 1000 },
    transport,
  )
  const connection = await db
    .select({ name: bankConnections.name })
    .from(bankConnections)
    .where(inHousehold(db, bankConnections, eq(bankConnections.id, id)))
    .get()
  const by = `SimpleFIN (${connection?.name ?? 'connection'})`

  const results: Array<SyncedAccount> = []
  const covered = (
    m: (typeof mapped)[number],
    set: { syncedThrough?: string },
  ) =>
    db
      .update(bankAccounts)
      .set({ ...set, moneyInSince: m.moneyInSince ?? fetchFrom })
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
      if (account.closed) {
        // Nothing to read, so no reason to reach back for it again.
        if (!m.moneyInSince) await covered(m, {})
        continue
      }
      const debt = isDebt(account)
      const result: SyncedAccount = { account: account.name }
      if (SPENDING_KINDS.includes(account.kind)) {
        const rows: Array<PostedRow> = []
        const incoming: Array<IncomingRow> = []
        let excluded = 0
        for (const t of source.transactions) {
          const row = purchaseRow(t, debt, timeZone)
          const ours = !!t.posted && t.posted >= purchasesFrom
          if (row === 'excluded') {
            if (ours) excluded++
            const money = incomingRow(t, debt, timeZone)
            if (money) incoming.push(money)
          } else if (row && ours) rows.push(row)
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
        if (!debt)
          result.moneyIn = await recordMoneyIn(
            db,
            account.name,
            incoming,
            `simplefin:${m.providerId}`,
          )
      }
      // SimpleFIN shows what's owed as negative; Budgy as positive.
      const cents = Math.round(Number(source.balance) * 100)
      await recordBalances(
        db,
        [
          {
            account: account.name,
            date: source.balanceDate
              ? dateOn(new Date(source.balanceDate * 1000), timeZone)
              : until,
            amount: debt ? -cents : cents,
          },
        ],
        by,
      )
      result.balance = true
      await covered(m, { syncedThrough: until })
      results.push(result)
    } catch (error) {
      results.push({
        account: accountName,
        error: clientMessage(
          error,
          'This sync didn’t finish. Budgy will try again.',
        ),
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
  secret: BankKeys,
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
