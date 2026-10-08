/**
 * Planned Expenses on the calendar (docs/adr/0002): when each comes due,
 * which Transaction paid it, and what to set aside each month.
 */

import { CADENCE_MONTHS } from './types'
import { addMonths, daysBetween, monthsBetween } from './dates'
import { categoryOf } from './ledger'
import type { LedgerIndex } from './ledger'
import type { Plan, Txn } from './types'

export interface Occurrence {
  plan: Plan
  due: string
  /** The Transaction that paid it, once one is imported. */
  paidBy: Txn | null
}

/** Due dates of `plan` within [from, to], inclusive. */
export function dueDates(plan: Plan, from: string, to: string): Array<string> {
  const step = CADENCE_MONTHS[plan.cadence]
  if (step === 0)
    return plan.anchor >= from && plan.anchor <= to ? [plan.anchor] : []
  // Step from the anchor itself every time, so month-end days don't drift.
  const first = Math.floor(monthsBetween(plan.anchor, from) / step) - 1
  const last = Math.ceil(monthsBetween(plan.anchor, to) / step) + 1
  const out: Array<string> = []
  for (let k = first; k <= last; k++) {
    const d = addMonths(plan.anchor, k * step)
    if (d >= from && d <= to) out.push(d)
  }
  return out
}

/** How far from its due date a payment may land and still count. */
export function matchWindowDays(plan: Plan): number {
  return plan.cadence === 'monthly' ? 10 : 21
}

function matches(ix: LedgerIndex, plan: Plan, t: Txn): boolean {
  if (t.amount <= 0 || categoryOf(ix, t) !== plan.category) return false
  if (plan.store) return t.store === plan.store && t.amount >= plan.amount * 0.4
  return Math.abs(t.amount - plan.amount) <= plan.amount * 0.1
}

/**
 * Every due date of the active Plans in [from, to], each paired with the
 * closest unclaimed Transaction that pays it. A Transaction pays at most one.
 */
export function schedule(
  ix: LedgerIndex,
  from: string,
  to: string,
): Array<Occurrence> {
  const claimed = new Set<string>()
  const out: Array<Occurrence> = []
  for (const plan of ix.ledger.plans) {
    if (!plan.active) continue
    const window = matchWindowDays(plan)
    const candidates = ix.ledger.txns.filter((t) => matches(ix, plan, t))
    for (const due of dueDates(plan, from, to)) {
      let best: Txn | null = null
      let bestGap = Infinity
      for (const t of candidates) {
        if (claimed.has(t.id)) continue
        const gap = Math.abs(daysBetween(due, t.date))
        if (gap <= window && gap < bestGap) {
          best = t
          bestGap = gap
        }
      }
      if (best) claimed.add(best.id)
      out.push({ plan, due, paidBy: best })
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due))
}

/** Ids of Transactions that paid a Planned Expense. */
export function plannedTxnIds(occurrences: Array<Occurrence>): Set<string> {
  const ids = new Set<string>()
  for (const o of occurrences) if (o.paidBy) ids.add(o.paidBy.id)
  return ids
}

/** What a Plan costs per month, spread evenly: its set-aside. */
export function monthlySetAside(plan: Plan): number {
  const step = CADENCE_MONTHS[plan.cadence]
  return step === 0 ? 0 : Math.round(plan.amount / step)
}
