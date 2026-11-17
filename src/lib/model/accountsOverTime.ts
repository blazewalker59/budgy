/**
 * Every Account's Balance over time, for the Accounts screen's chart: each
 * one as it counts toward net worth (what's owed below zero), in the
 * screen's groups, sampled through a span of days. An Account counts from
 * its first Balance, holding each Balance until the next, as net worth
 * does; so the groups always add up to net worth.
 */

import { ACCOUNT_GROUPS, isDebt, worth } from './accounts'
import { addDays, daysBetween } from './dates'
import type { Account, Balance, Ledger } from './types'

/** The most dates to sample; longer spans skip evenly between them. */
const MAX_POINTS = 120

export interface AccountLine {
  account: Account
  /** Toward net worth at each date, cents; 0 before its first Balance. */
  values: Array<number>
}

export interface GroupLine {
  title: string
  /** Owed: drawn below zero. */
  debt: boolean
  values: Array<number>
  /** Biggest (by its latest size) first. */
  accounts: Array<AccountLine>
}

export interface AccountsOverTime {
  dates: Array<string>
  /** In the screen's order; groups with no Balance in the span left out. */
  groups: Array<GroupLine>
  net: Array<number>
}

/** Days from `from` to `to`, every day or evenly spaced, always ending on `to`. */
export function sampleDates(
  from: string,
  to: string,
  max = MAX_POINTS,
): Array<string> {
  const days = daysBetween(from, to)
  if (days < 0) return []
  const step = Math.max(1, Math.ceil(days / (max - 1)))
  const out: Array<string> = []
  for (let d = 0; d < days; d += step) out.push(addDays(from, d))
  out.push(to)
  return out
}

/** One Account's latest Balance as of each date (dates in order). */
function asOf(own: Array<Balance>, dates: Array<string>): Array<number | null> {
  const sorted = [...own].sort((a, b) => a.date.localeCompare(b.date))
  let i = -1
  return dates.map((date) => {
    while (i + 1 < sorted.length && sorted[i + 1].date <= date) i++
    return i >= 0 ? sorted[i].amount : null
  })
}

export function accountsOverTime(
  ledger: Ledger,
  from: string,
  to: string,
): AccountsOverTime {
  const dates = sampleDates(from, to)
  const byAccount = new Map<string, Array<Balance>>()
  for (const b of ledger.balances) {
    const list = byAccount.get(b.account)
    if (list) list.push(b)
    else byAccount.set(b.account, [b])
  }
  const groups: Array<GroupLine> = []
  for (const g of ACCOUNT_GROUPS) {
    const accounts = ledger.accounts
      .filter((a) => g.kinds.includes(a.kind) && byAccount.has(a.name))
      .map((account) => ({
        account,
        values: asOf(byAccount.get(account.name)!, dates).map((v) =>
          v === null ? 0 : worth(account, v),
        ),
      }))
      .filter((l) => l.values.some((v) => v !== 0))
      .sort(
        (a, b) =>
          Math.abs(b.values[b.values.length - 1]) -
            Math.abs(a.values[a.values.length - 1]) ||
          a.account.name.localeCompare(b.account.name),
      )
    if (!accounts.length) continue
    groups.push({
      title: g.title,
      debt: isDebt({ kind: g.kinds[0] }),
      values: dates.map((_, i) =>
        accounts.reduce((n, l) => n + l.values[i], 0),
      ),
      accounts,
    })
  }
  return {
    dates,
    groups,
    net: dates.map((_, i) => groups.reduce((n, g) => n + g.values[i], 0)),
  }
}
