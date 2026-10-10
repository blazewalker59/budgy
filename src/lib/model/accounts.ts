/**
 * Accounts as a portfolio: each one's latest Balance, net worth (what's
 * held minus what's owed on cards and loans) and how both moved month by
 * month, carrying a Balance forward until a newer one is recorded. Pure.
 */

import { z } from 'zod'
import { lastDayOf, monthRange } from './dates'
import { ACCOUNT_KINDS, DEBT_KINDS } from './types'
import type { Account, AccountKind, Balance, Ledger } from './types'

export const accountInput = z.object({
  name: z.string().trim().min(1).max(60),
  owner: z.string().trim().min(1).max(40),
  kind: z
    .enum(ACCOUNT_KINDS as [string, ...Array<string>])
    .transform((k) => k as AccountKind),
  institution: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .transform((s) => s || null),
  closed: z.boolean(),
  securedBy: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((s) => s || null),
})

export const balanceInput = z.object({
  account: z.string().trim().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Cents, as the account shows it; a card's balance owed is positive. */
  amount: z.number().int().min(-10_000_000_000).max(10_000_000_000),
})

export function isDebt(account: Pick<Account, 'kind'>): boolean {
  return DEBT_KINDS.has(account.kind)
}

/** A Balance as it counts toward net worth: what's owed counts against. */
export function worth(account: Pick<Account, 'kind'>, amount: number): number {
  return isDebt(account) ? -amount : amount
}

/** Each Account's newest Balance on or before `asOf` (default: ever). */
export function latestBalances(
  balances: Array<Balance>,
  asOf = '9999-12-31',
): Map<string, Balance> {
  const out = new Map<string, Balance>()
  for (const b of balances) {
    if (b.date > asOf) continue
    const had = out.get(b.account)
    if (!had || b.date > had.date) out.set(b.account, b)
  }
  return out
}

export interface NetWorth {
  assets: number
  debts: number
  net: number
}

/** Net worth from each open Account's newest Balance on or before `asOf`. */
export function netWorth(ledger: Ledger, asOf?: string): NetWorth {
  const latest = latestBalances(ledger.balances, asOf)
  let assets = 0
  let debts = 0
  for (const a of ledger.accounts) {
    const b = latest.get(a.name)
    if (!b || a.closed) continue
    if (isDebt(a)) debts += b.amount
    else assets += b.amount
  }
  return { assets, debts, net: assets - debts }
}

export interface WorthMonth extends NetWorth {
  month: string
}

/**
 * Net worth on a day, from every Balance on or before it. An Account counts
 * from its first Balance; a closed one counts until it's closed only if it
 * was given a final Balance (closing records zero).
 */
function worthAsOf(ledger: Ledger, date: string): NetWorth {
  const kinds = new Map(ledger.accounts.map((a) => [a.name, a]))
  let assets = 0
  let debts = 0
  for (const [name, b] of latestBalances(ledger.balances, date)) {
    const a = kinds.get(name)
    if (!a) continue
    if (isDebt(a)) debts += b.amount
    else assets += b.amount
  }
  return { assets, debts, net: assets - debts }
}

/** Net worth at each month's end (`worthAsOf`). */
export function netWorthByMonth(
  ledger: Ledger,
  months: Array<string>,
): Array<WorthMonth> {
  return months.map((month) => ({
    month,
    ...worthAsOf(ledger, lastDayOf(month)),
  }))
}

/** Each Account's first Balance date. */
function firstBalances(balances: Array<Balance>): Map<string, string> {
  const out = new Map<string, string>()
  for (const b of balances) {
    const had = out.get(b.account)
    if (!had || b.date < had) out.set(b.account, b.date)
  }
  return out
}

/**
 * The baseline net worth is counted from when none is chosen: the first
 * day every open Account had a Balance. Before it, history is mostly
 * Accounts arriving (a backfilled card, then everything else on the day
 * it was set up), not money gained.
 */
export function autoBaseline(ledger: Ledger): string | null {
  const firsts = firstBalances(ledger.balances)
  let out: string | null = null
  for (const a of ledger.accounts) {
    const first = firsts.get(a.name)
    if (a.closed || !first) continue
    if (!out || first > out) out = first
  }
  return out
}

export interface WorthHistory {
  baseline: string
  /** No baseline was chosen: it's `autoBaseline`. */
  auto: boolean
  /** Net worth on the baseline, and today. */
  start: number
  now: number
  /** The baseline's month (as of the baseline), then each month's end. */
  points: Array<{ month: string; value: number }>
  /** Open Accounts with no Balance yet on the baseline: their arrival counts as change. */
  late: Array<string>
}

/** Net worth from the baseline (chosen, else `autoBaseline`) to today. */
export function worthHistory(
  ledger: Ledger,
  chosen: string | null,
  today: string,
): WorthHistory | null {
  const baseline = chosen ?? autoBaseline(ledger)
  if (!baseline) return null
  const first = baseline.slice(0, 7)
  const now = today.slice(0, 7)
  const later = first < now ? monthRange(now, 600).filter((m) => m > first) : []
  const start = worthAsOf(ledger, baseline).net
  const firsts = firstBalances(ledger.balances)
  return {
    baseline,
    auto: chosen === null,
    start,
    now: worthAsOf(ledger, today).net,
    points: [
      { month: first, value: start },
      ...later.map((m) => ({
        month: m,
        value: worthAsOf(ledger, m === now ? today : lastDayOf(m)).net,
      })),
    ],
    late: ledger.accounts
      .filter((a) => {
        const f = firsts.get(a.name)
        return !a.closed && f !== undefined && f > baseline
      })
      .map((a) => a.name),
  }
}

/** The Accounts screen's groups, in order. */
export const ACCOUNT_GROUPS: ReadonlyArray<{
  title: string
  kinds: ReadonlyArray<AccountKind>
}> = [
  { title: 'Cash', kinds: ['checking', 'savings'] },
  { title: 'Credit cards', kinds: ['credit'] },
  { title: 'Investments', kinds: ['brokerage'] },
  { title: 'Retirement', kinds: ['retirement'] },
  { title: 'Education', kinds: ['education'] },
  { title: 'Home & property', kinds: ['property'] },
  { title: 'Loans', kinds: ['loan'] },
  { title: 'Other', kinds: ['other'] },
]

export interface WorthPart {
  title: string
  /** Cents; what's owed is positive on the debts side. */
  total: number
  accounts: Array<{ account: Account; amount: number }>
}

/**
 * What one side of net worth is made of: each group of open Accounts with
 * a Balance, largest first, and its Accounts, largest first.
 */
export function worthParts(
  ledger: Ledger,
  side: 'assets' | 'debts',
): Array<WorthPart> {
  const latest = latestBalances(ledger.balances)
  return ACCOUNT_GROUPS.map((g) => {
    const accounts = ledger.accounts
      .filter(
        (a) =>
          !a.closed &&
          g.kinds.includes(a.kind) &&
          isDebt(a) === (side === 'debts') &&
          latest.has(a.name),
      )
      .map((account) => ({
        account,
        amount: latest.get(account.name)!.amount,
      }))
      .sort((a, b) => b.amount - a.amount)
    return {
      title: g.title,
      total: accounts.reduce((n, a) => n + a.amount, 0),
      accounts,
    }
  })
    .filter((p) => p.accounts.length)
    .sort((a, b) => b.total - a.total)
}

/** One Account's Balance at each month's end, null before its first. */
export function balanceByMonth(
  balances: Array<Balance>,
  account: string,
  months: Array<string>,
): Array<number | null> {
  const own = balances.filter((b) => b.account === account)
  return months.map(
    (m) => latestBalances(own, lastDayOf(m)).get(account)?.amount ?? null,
  )
}

export interface Activity {
  purchases: number
  first: string
  last: string
}

/** How far each Account's Transactions reach. */
export function activity(ledger: Ledger): Map<string, Activity> {
  const out = new Map<string, Activity>()
  for (const t of ledger.txns) {
    const s = out.get(t.account) ?? {
      purchases: 0,
      first: t.date,
      last: t.date,
    }
    s.purchases++
    if (t.date < s.first) s.first = t.date
    if (t.date > s.last) s.last = t.date
    out.set(t.account, s)
  }
  return out
}

/** Every owner in use, the Household's own first. */
export function ownerNames(
  accounts: Array<Account>,
  base: ReadonlyArray<string>,
): Array<string> {
  return [...new Set([...base, ...accounts.map((a) => a.owner)])]
}

export interface Equity {
  property: string
  /** The property's latest estimated value, in cents. */
  value: number
  /** Every open loan against it, at its latest balance. */
  owed: number
  equity: number
  loans: Array<string>
}

/** Each open property's value, the loans against it, and what's left. */
export function equity(ledger: Ledger): Array<Equity> {
  const latest = latestBalances(ledger.balances)
  return ledger.accounts
    .filter((a) => a.kind === 'property' && !a.closed)
    .map((p) => {
      const loans = ledger.accounts.filter(
        (a) => a.kind === 'loan' && !a.closed && a.securedBy === p.name,
      )
      const value = latest.get(p.name)?.amount ?? 0
      const owed = loans.reduce(
        (n, l) => n + (latest.get(l.name)?.amount ?? 0),
        0,
      )
      return {
        property: p.name,
        value,
        owed,
        equity: value - owed,
        loans: loans.map((l) => l.name),
      }
    })
}
