/**
 * The Daily Digest: one day's purchases across every Account, by person
 * and by Account, with the month so far. What an Agent sends each morning.
 * Pure.
 */

import { categoryOf, ownerOf } from './ledger'
import { monthView } from './month'
import type { LedgerIndex } from './ledger'
import type { Occurrence } from './plans'
import type { Txn } from './types'

export interface DigestTxn {
  id: string
  date: string
  account: string
  owner: string
  store: string
  description: string
  category: string
  /** Dollars, positive for spending, negative for a refund. */
  amount: number
  note: string | null
  /** Paid a Planned Expense. */
  planned: boolean
}

export interface Digest {
  date: string
  count: number
  total: number
  byOwner: Array<{ owner: string; total: number; count: number }>
  byAccount: Array<{
    account: string
    owner: string
    total: number
    count: number
  }>
  byCategory: Array<{ category: string; total: number }>
  transactions: Array<DigestTxn>
  monthToDate: { spent: number; target: number; plannedLeft: number }
  /** Each Account's latest imported purchase: a digest is only as fresh as the imports. */
  freshness: Array<{ account: string; latest: string }>
}

const toDollars = (cents: number) => Math.round(cents) / 100

export function agentTxn(
  ix: LedgerIndex,
  t: Txn,
  plannedIds: Set<string>,
): DigestTxn {
  return {
    id: t.id,
    date: t.date,
    account: t.account,
    owner: ownerOf(ix, t),
    store: t.store,
    description: t.description,
    category: categoryOf(ix, t),
    amount: toDollars(t.amount),
    note: t.note,
    planned: plannedIds.has(t.id),
  }
}

function tally<TKey extends string>(
  rows: Array<{ key: TKey; amount: number }>,
): Map<TKey, { total: number; count: number }> {
  const m = new Map<TKey, { total: number; count: number }>()
  for (const r of rows) {
    const x = m.get(r.key) ?? { total: 0, count: 0 }
    x.total += r.amount
    x.count++
    m.set(r.key, x)
  }
  return m
}

export function dailyDigest(
  ix: LedgerIndex,
  date: string,
  today: string,
  occurrences: Array<Occurrence>,
  plannedIds: Set<string>,
): Digest {
  const day = ix.ledger.txns
    .filter((t) => t.date === date)
    .sort((a, b) => b.amount - a.amount)
  const txns = day.map((t) => agentTxn(ix, t, plannedIds))
  const owners = tally(txns.map((t) => ({ key: t.owner, amount: t.amount })))
  const accts = tally(txns.map((t) => ({ key: t.account, amount: t.amount })))
  const cats = tally(txns.map((t) => ({ key: t.category, amount: t.amount })))
  const view = monthView(ix, date.slice(0, 7), today, null, occurrences)
  const latest = new Map<string, string>()
  for (const t of ix.ledger.txns)
    if ((latest.get(t.account) ?? '') < t.date) latest.set(t.account, t.date)
  const round = (n: number) => Math.round(n * 100) / 100

  return {
    date,
    count: txns.length,
    total: round(txns.reduce((n, t) => n + t.amount, 0)),
    byOwner: [...owners]
      .map(([owner, v]) => ({ owner, total: round(v.total), count: v.count }))
      .sort((a, b) => b.total - a.total),
    byAccount: [...accts]
      .map(([account, v]) => ({
        account,
        owner: ix.owners.get(account) ?? 'Joint',
        total: round(v.total),
        count: v.count,
      }))
      .sort((a, b) => b.total - a.total),
    byCategory: [...cats]
      .map(([category, v]) => ({ category, total: round(v.total) }))
      .sort((a, b) => b.total - a.total),
    transactions: txns,
    monthToDate: {
      spent: toDollars(view.totals.spent),
      target: toDollars(view.totals.target),
      plannedLeft: toDollars(view.totals.plannedLeft),
    },
    freshness: [...latest]
      .map(([account, d]) => ({ account, latest: d }))
      .sort(
        (a, b) =>
          a.latest.localeCompare(b.latest) ||
          a.account.localeCompare(b.account),
      ),
  }
}
