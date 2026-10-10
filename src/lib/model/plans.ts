/**
 * Planned Expenses on the calendar (docs/adr/0002): when each comes due,
 * which Transaction paid it, and what to set aside each month. Monthly ones
 * are tracked for their due dates but count toward Targets like any
 * purchase; the rest are set aside, outside Targets.
 */

import { CADENCE_MONTHS } from './types'
import { addDays, addMonths, daysBetween, monthsBetween } from './dates'
import { categoryOf } from './ledger'
import type { LedgerIndex } from './ledger'
import type { Plan, Txn } from './types'

export interface Occurrence {
  plan: Plan
  due: string
  /** The Transaction that paid it, once one is imported. */
  paidBy: Txn | null
}

/**
 * Whether a Plan is budgeted on its due dates, outside Targets: anything
 * less often than monthly. A monthly bill is part of a typical month, so its
 * payments count toward its Category's Target.
 */
export function setAside(plan: Pick<Plan, 'cadence'>): boolean {
  return CADENCE_MONTHS[plan.cadence] !== 1
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

/**
 * Ids of Transactions that paid a set-aside Planned Expense: the ones kept
 * out of everyday spending. A monthly bill's payments aren't among them.
 */
export function plannedTxnIds(occurrences: Array<Occurrence>): Set<string> {
  const ids = new Set<string>()
  for (const o of occurrences)
    if (o.paidBy && setAside(o.plan)) ids.add(o.paidBy.id)
  return ids
}

/**
 * What a set-aside Plan costs per month, spread evenly. Nothing for a
 * monthly one (its Target covers it) or a one-off.
 */
export function monthlySetAside(plan: Plan): number {
  const step = CADENCE_MONTHS[plan.cadence]
  return step <= 1 ? 0 : Math.round(plan.amount / step)
}

/** How far ahead a Plan counts as coming up. */
export const COMING_UP_DAYS = 90

export type PlanStatus = 'late' | 'soon' | 'later' | 'paused'

export interface PlanLine {
  plan: Plan
  status: PlanStatus
  /** Its next unpaid due date (a late one first); null when there's none. */
  next: string | null
  /** Unpaid due dates after `next` within COMING_UP_DAYS (a monthly bill's). */
  more: number
  lastPaid: Txn | null
}

/**
 * Each Plan once, by when it's next due: late (due, no payment yet), coming
 * up (within COMING_UP_DAYS), later, or paused. Soonest first in each.
 */
export function planLines(
  plans: Array<Plan>,
  occurrences: Array<Occurrence>,
  today: string,
): Array<PlanLine> {
  const until = addDays(today, COMING_UP_DAYS)
  const lines = plans.map((plan): PlanLine => {
    const mine = occurrences.filter((o) => o.plan.id === plan.id)
    const lastPaid =
      [...mine].reverse().find((o) => o.paidBy && o.due <= until)?.paidBy ??
      null
    if (!plan.active)
      return { plan, status: 'paused', next: null, more: 0, lastPaid }
    // As upcoming() and the late-bill alert see it: unpaid, due from a
    // little before today (a payment can land late); late once past due.
    const open = mine.filter(
      (o) => !o.paidBy && o.due >= addDays(today, -matchWindowDays(plan)),
    )
    const next = open[0]
    const late = next && next.due < today
    return {
      plan,
      status: late ? 'late' : next && next.due <= until ? 'soon' : 'later',
      next: next?.due ?? null,
      more: open.filter((o) => o !== next && o.due <= until).length,
      lastPaid,
    }
  })
  const order: Record<PlanStatus, number> = {
    late: 0,
    soon: 1,
    later: 2,
    paused: 3,
  }
  return lines.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      (a.next ?? '9999').localeCompare(b.next ?? '9999') ||
      a.plan.name.localeCompare(b.plan.name),
  )
}
