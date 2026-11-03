/**
 * Syncing SimpleFIN accounts into the Budgy Accounts they're mapped to
 * (docs/adr/0010, 0014). One routine Bridge request per connection covers
 * every account; a newly linked one first reads back its history, up to
 * about six months in windows of at most 90 days, newest first. Posted
 * purchases go through the shared ingestion path with stable source IDs, so
 * overlapping windows never add a purchase twice, and each account's balance
 * is recorded. Pending transactions wait until they post.
 */
import { and, eq, isNotNull } from 'drizzle-orm'
import { ROUTINE_RESERVE, RequestLimitError, readBridge } from './connections'
import { isSpending } from './exports'
import type { SimplefinAccount, SimplefinTransaction } from './simplefinClient'
import type { BankKeys } from './crypto'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { z } from 'zod'
import type { PostedRow } from '@/lib/import/posted'
import type { PostInput } from '@/lib/ledger/accounts'
import type { IncomingRow } from '@/lib/model/moneyIn'
import { MAX_ROW_CENTS, postedRowInput } from '@/lib/import/posted'
import { MAX_BALANCE_CENTS, isDebt } from '@/lib/model/accounts'
import { recordMoneyIn } from '@/lib/moneyIn/service'
import { accounts, bankAccounts, bankConnections } from '@/lib/db/schema'
import { inHousehold } from '@/lib/households/scope'
import { postTransactions, recordBalances } from '@/lib/ledger/accounts'
import { UserError, clientMessage } from '@/lib/errors'
import { householdTimeZone } from '@/lib/households/locale'
import { addDays, dateOn, today } from '@/lib/model/dates'

/** Each sync re-reads this many days, for late-posting purchases. */
const OVERLAP_DAYS = 10
/** Bridge serves at most 90 days from start-date to end-date. */
export const WINDOW_DAYS = 90
/** How far back a newly linked account's history goes, where the bank has it. */
export const HISTORY_DAYS = 180
/** History windows one run asks for at most, beyond the routine request. */
const HISTORY_WINDOWS_PER_RUN = 4
const SPENDING_KINDS = ['credit', 'checking', 'savings']
const DAY = 86_400

/** Unix seconds at the start of a UTC day, and back. */
const startOf = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000
const utcDay = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

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

type SkippedRow = NonNullable<PostInput['unreadable']>[number]

/** A purchase row Budgy can't take, as the receipt lists it. */
function skippedRow(row: PostedRow, error: z.ZodError): SkippedRow {
  const amount = Number.isFinite(row.amount) ? row.amount : 0
  return {
    date: row.date,
    description: row.description.slice(0, 200),
    amount,
    reason: error.issues.some((i) => i.path[0] === 'amount')
      ? 'Skipped: Budgy takes purchases up to $1,000,000.'
      : 'Skipped: this purchase couldn’t be read.',
  }
}

/** Cents a Balance can hold (balanceInput's bounds). */
function plausibleBalance(cents: number) {
  return Number.isSafeInteger(cents) && Math.abs(cents) <= MAX_BALANCE_CENTS
}

/** Posted money into a bank Account, as Money in (docs/adr/0011). */
function incomingRow(
  t: SimplefinTransaction,
  debt: boolean,
  timeZone: string,
): IncomingRow | null {
  if (debt || t.pending || !t.posted) return null
  const cents = Math.round(Number(t.amount) * 100)
  // Same bound as a purchase; anything bigger isn't money in Budgy can use.
  if (!(cents > 0) || cents > MAX_ROW_CENTS) return null
  return {
    date: dateOn(new Date((t.transactedAt ?? t.posted) * 1000), timeZone),
    description: t.description.slice(0, 200) || 'Money in',
    amount: cents,
    sourceId: t.id,
  }
}

type Mapped = typeof bankAccounts.$inferSelect

/** One request's span: Unix seconds, `end` exclusive (now when absent). */
interface Window {
  start: number
  end?: number
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
  const [timeZone, connection, ledgerAccounts] = await Promise.all([
    householdTimeZone(db),
    db
      .select({ name: bankConnections.name })
      .from(bankConnections)
      .where(inHousehold(db, bankConnections, eq(bankConnections.id, id)))
      .get(),
    db
      .select({
        name: accounts.name,
        kind: accounts.kind,
        owner: accounts.owner,
        closed: accounts.closed,
      })
      .from(accounts)
      .where(inHousehold(db, accounts)),
  ])
  const until = today(timeZone)
  const now = Math.floor(Date.now() / 1000)
  const utcToday = utcDay(now)
  // The newest window Bridge allows: 90 days back from now, to a UTC day.
  const newest = startOf(addDays(utcToday, -(WINDOW_DAYS - 1)))
  const oldest = addDays(utcToday, -(HISTORY_DAYS - 1))
  const by = `SimpleFIN (${connection?.name ?? 'connection'})`
  const accountOf = (m: Mapped) =>
    ledgerAccounts.find((a) => a.name === m.account)
  /** Purchases and Money in to read back for, not just a balance. */
  const wantsHistory = (m: Mapped) => {
    const account = accountOf(m)
    return (
      !m.historyComplete &&
      !!account &&
      !account.closed &&
      SPENDING_KINDS.includes(account.kind)
    )
  }

  // One result per account, however many windows it was read in.
  const byAccount = new Map<string, SyncedAccount>()
  const results = {
    push(result: SyncedAccount) {
      const seen = byAccount.get(result.account)
      if (!seen) return void byAccount.set(result.account, result)
      for (const key of ['added', 'moneyIn'] as const)
        if (result[key] !== undefined)
          seen[key] = (seen[key] ?? 0) + result[key]
      if (result.balance) seen.balance = true
      if (result.error) seen.error = result.error
    },
    get length() {
      return byAccount.size
    },
  }
  const save = (m: Mapped, set: Partial<Mapped>) => {
    Object.assign(m, set)
    return db
      .update(bankAccounts)
      .set(set)
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
  }

  /**
   * Take one account's part of a response: its purchases and Money in from
   * the window, and its balance. An older history window brings no balance,
   * and no receipt unless it has purchases, so an empty one doesn't stand
   * in for the account's latest update. Returns whether it was taken, and
   * the posted times it had in the window.
   */
  const take = async (
    m: Mapped,
    found: Array<SimplefinAccount>,
    window: Window,
    older = false,
  ): Promise<{ ok: boolean; posted: Array<number> }> => {
    const accountName = m.account!
    const source = found.find((a) => a.id === m.providerId)
    if (!source) {
      results.push({
        account: accountName,
        error: `SimpleFIN no longer shares ${m.name}.`,
      })
      return { ok: false, posted: [] }
    }
    const account = accountOf(m)
    // Closed (or gone) since: nothing to read for it.
    if (!account || account.closed) return { ok: false, posted: [] }
    const inWindow = source.transactions.filter(
      (t) =>
        !t.pending &&
        !!t.posted &&
        t.posted >= window.start &&
        (window.end === undefined || t.posted < window.end),
    )
    const posted = inWindow.map((t) => t.posted!)
    try {
      const debt = isDebt(account)
      const result: SyncedAccount = { account: account.name }
      if (SPENDING_KINDS.includes(account.kind)) {
        const rows: Array<PostedRow> = []
        const incoming: Array<IncomingRow> = []
        const unreadable: Array<SkippedRow> = []
        let excluded = 0
        for (const t of inWindow) {
          const row = purchaseRow(t, debt, timeZone)
          if (row === 'excluded') {
            excluded++
            const money = incomingRow(t, debt, timeZone)
            if (money) incoming.push(money)
          } else if (row) {
            // One row Budgy can't take (over $1M, say) mustn't stop the
            // rest, or this account would never get past it.
            const valid = postedRowInput.safeParse(row)
            if (valid.success) rows.push(row)
            else unreadable.push(skippedRow(row, valid.error))
          }
        }
        if (!older || rows.length || unreadable.length) {
          const summary = await postTransactions(db, {
            account: account.name,
            rows,
            commit: true,
            importedBy: by,
            via: 'simplefin',
            sourceNamespace: `simplefin:${m.providerId}`,
            excluded,
            unreadable,
            coverage: {
              from: dateOn(new Date(window.start * 1000), timeZone),
              to:
                window.end === undefined
                  ? until
                  : dateOn(new Date((window.end - 1) * 1000), timeZone),
            },
          })
          result.added = summary.added
        }
        if (!debt)
          result.moneyIn = await recordMoneyIn(
            db,
            account.name,
            incoming,
            `simplefin:${m.providerId}`,
          )
      }
      if (!older) {
        // SimpleFIN shows what's owed as negative; Budgy as positive.
        const cents = Math.round(Number(source.balance) * 100)
        if (!plausibleBalance(cents)) {
          result.error = `SimpleFIN’s balance for ${m.name} couldn’t be read, so it wasn’t recorded.`
        } else {
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
        }
      }
      results.push(result)
      return { ok: true, posted }
    } catch (error) {
      results.push({
        account: accountName,
        error: clientMessage(
          error,
          'This sync didn’t finish. Budgy will try again.',
        ),
      })
      return { ok: false, posted }
    }
  }

  /**
   * Where an account's history stands after a window it was read in. One
   * with nothing posted in it means the bank has no older history (a quiet
   * account's gap of weeks doesn't: only an empty window does).
   */
  const historyAfter = (window: Window, posted: Array<number>) => {
    const from = utcDay(window.start)
    return {
      historyFrom: from,
      historyComplete: !posted.length || from <= oldest,
    }
  }

  // Routine: one request for every account already reading (and any that
  // only want a balance), from the earliest one's last day less the overlap.
  const first = mapped.filter((m) => wantsHistory(m) && !m.syncedThrough)
  const routine = mapped.filter((m) => !first.includes(m))
  if (routine.length) {
    const from = routine
      .map((m) => addDays(m.syncedThrough ?? until, -OVERLAP_DAYS))
      .reduce((a, b) => (a < b ? a : b))
    // A day early, so no time zone drops the first day's purchases.
    const window = { start: Math.max(startOf(addDays(from, -1)), newest) }
    const { accounts: found } = await readBridge(
      db,
      id,
      secret,
      { start: window.start },
      transport,
    )
    for (const m of routine) {
      const { ok } = await take(m, found, window)
      if (!ok) continue
      const complete = !wantsHistory(m)
      await save(m, {
        syncedThrough: until,
        moneyInSince: m.moneyInSince ?? utcDay(window.start),
        ...(complete && {
          historyComplete: true,
          historyFrom: m.historyFrom ?? utcDay(window.start),
        }),
      })
    }
  }

  // History, newest window first: accounts reading back from the same day
  // share one request for just them. Each window is asked for once a run;
  // what's left (today's requests used up, a failure) resumes next run.
  const asked = new Set<string>()
  const windowOf = (m: Mapped) => `${m.providerId}\u0000${m.historyFrom ?? ''}`
  for (let n = 0; n < HISTORY_WINDOWS_PER_RUN; n++) {
    const due = mapped.filter((m) => wantsHistory(m) && !asked.has(windowOf(m)))
    if (!due.length) break
    const next = due
      .map((m) => m.historyFrom ?? '')
      .reduce((a, b) => (a === '' || b === '' ? '' : a > b ? a : b))
    const group = due.filter((m) => (m.historyFrom ?? '') === next)
    for (const m of group) asked.add(windowOf(m))
    const window: Window = next
      ? {
          start: Math.max(startOf(next) - WINDOW_DAYS * DAY, startOf(oldest)),
          end: startOf(next),
        }
      : { start: newest }
    let found: Array<SimplefinAccount>
    try {
      ;({ accounts: found } = await readBridge(
        db,
        id,
        secret,
        {
          ...window,
          accounts: group.map((m) => m.providerId),
          // An account's first window is its sync; older ones can wait.
          reserve: next ? ROUTINE_RESERVE : 0,
        },
        transport,
      ))
    } catch (error) {
      // Nothing synced yet this run: the caller should hear why.
      if (!routine.length && !results.length) throw error
      if (!(error instanceof RequestLimitError)) break
      continue
    }
    for (const m of group) {
      const { ok, posted } = await take(m, found, window, !!next)
      if (!ok) continue
      await save(m, {
        ...historyAfter(window, posted),
        ...(!m.syncedThrough && { syncedThrough: until }),
        moneyInSince: utcDay(window.start),
      })
    }
  }
  return [...byAccount.values()]
}
