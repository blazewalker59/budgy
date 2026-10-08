/**
 * Spotting likely Planned Expenses in history: the same Store charging a
 * large amount every 3, 6 or 12 months (car insurance, an annual
 * membership). Suggestions only; a Member decides.
 */

import { addMonths, daysBetween } from './dates'
import { categoryOf } from './ledger'
import type { LedgerIndex } from './ledger'
import type { Cadence, Txn } from './types'

export interface Suggestion {
  store: string
  category: string
  cadence: Cadence
  /** The latest charge. */
  amount: number
  /** The next due date, stepped from the latest charge. */
  nextDue: string
  charges: Array<Txn>
}

const MIN_CENTS = 15_000
const CYCLES: Array<[Cadence, number]> = [
  ['quarterly', 3],
  ['semiannual', 6],
  ['annual', 12],
]

export function suggestPlans(
  ix: LedgerIndex,
  today: string,
): Array<Suggestion> {
  const planned = new Set(
    ix.ledger.plans.flatMap((p) => (p.store ? [p.store] : [])),
  )
  const groups = new Map<string, Array<Txn>>()
  for (const t of ix.ledger.txns) {
    if (t.amount < MIN_CENTS || planned.has(t.store)) continue
    const key = `${categoryOf(ix, t)}\u0000${t.store}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: Array<Suggestion> = []
  for (const charges of groups.values()) {
    if (charges.length < 2) continue
    charges.sort((a, b) => a.date.localeCompare(b.date))
    const gaps = charges
      .slice(1)
      .map((t, i) => daysBetween(charges[i].date, t.date) / 30.44)
    const cycle = CYCLES.find(
      ([, months]) =>
        gaps.every((g) => Math.abs(g - months) <= 1) &&
        // Two quarterly charges are too easily a coincidence.
        (months > 3 || charges.length >= 3),
    )
    if (!cycle) continue
    const latest = charges[charges.length - 1]
    // A bill is about the same each time; a restaurant isn't.
    const amounts = charges.map((t) => t.amount)
    if (Math.min(...amounts) < Math.max(...amounts) * 0.7) continue
    // Stopped: nothing for more than a cycle and a half.
    if (daysBetween(latest.date, today) > cycle[1] * 30.44 * 1.5) continue
    let nextDue = addMonths(latest.date, cycle[1])
    while (nextDue < today) nextDue = addMonths(nextDue, cycle[1])
    out.push({
      store: latest.store,
      category: categoryOf(ix, latest),
      cadence: cycle[0],
      amount: latest.amount,
      nextDue,
      charges,
    })
  }
  return out.sort((a, b) => b.amount - a.amount)
}
