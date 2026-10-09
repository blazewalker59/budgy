/**
 * Accounts as a portfolio: each one's latest Balance, net worth (what's
 * held minus what's owed on cards and loans) and how both moved month by
 * month, carrying a Balance forward until a newer one is recorded. Pure.
 */

import { z } from 'zod'
import { lastDayOf } from './dates'
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
 * Net worth at each month's end. An Account counts from its first Balance;
 * a closed one counts until it's closed only if it was given a final
 * Balance (closing records zero).
 */
export function netWorthByMonth(
  ledger: Ledger,
  months: Array<string>,
): Array<WorthMonth> {
  const kinds = new Map(ledger.accounts.map((a) => [a.name, a]))
  return months.map((month) => {
    const latest = latestBalances(ledger.balances, lastDayOf(month))
    let assets = 0
    let debts = 0
    for (const [name, b] of latest) {
      const a = kinds.get(name)
      if (!a) continue
      if (isDebt(a)) debts += b.amount
      else assets += b.amount
    }
    return { month, assets, debts, net: assets - debts }
  })
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
