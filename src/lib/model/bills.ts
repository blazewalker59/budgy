/**
 * The month's bills, for the top of Overview: Housing (mortgage, utilities,
 * upkeep) and Planned Expenses, as what's been paid and what's still
 * coming. "Still coming" is a Planned Expense not yet paid, or a Housing
 * Category that posts most months but hasn't this month (at about the day
 * it usually does). Together with take-home pay, it says where the
 * Household is in the month.
 */

import { categoryOf, isHousing } from './ledger'
import { lastDayOf, monthRange, shiftMonth } from './dates'
import { paydays } from './pay'
import type { LedgerIndex } from './ledger'
import type { MonthView } from './month'
import type { PaySchedule } from './types'

interface BillLine {
  name: string
  /** Cents: what was paid, what's due, or (usual) about what's to come. */
  amount: number
  /** When it was paid or is due; for `usual`, the day it usually posts. */
  date: string | null
  status: 'paid' | 'due' | 'usual'
  /** Paid so far, with about this much more usually still to come. */
  more?: { amount: number; date: string }
}

export interface MonthBills {
  /** Paid lines biggest first, then what's coming by date. */
  lines: Array<BillLine>
  paid: number
  /** Paid plus everything still coming. */
  expected: number
}

/** Months of history that decide what a Housing Category usually costs. */
const USUAL_MONTHS = 6
/** Months of those it must post in to count as a monthly bill. */
const REGULAR_MONTHS = 4
/**
 * How far a bill's months may spread (standard deviation over the mean):
 * utilities move with the seasons; home upkeep swings too much to expect.
 */
const STEADY = 0.5

export function monthBills(
  ix: LedgerIndex,
  view: MonthView,
  today: string,
  plannedIds: Set<string>,
  /** Look for Housing that usually posts by now (not under a Lens). */
  withUsual = true,
): MonthBills {
  const paid: Array<BillLine> = []
  const coming: Array<BillLine> = []
  for (const r of view.housing)
    if (r.spent > 0)
      paid.push({
        name: r.name,
        amount: r.spent,
        date: r.txns[r.txns.length - 1]?.date ?? null,
        status: 'paid',
      })
  for (const r of [...view.everyday, ...view.housing])
    for (const o of r.planned)
      if (o.paidBy)
        paid.push({
          name: o.plan.name,
          amount: o.paidBy.amount,
          date: o.paidBy.date,
          status: 'paid',
        })
      else
        coming.push({
          name: o.plan.name,
          amount: o.plan.amount,
          date: o.due,
          status: 'due',
        })

  // Housing that posts most months but hasn't yet, while the month is open.
  if (withUsual && today <= lastDayOf(view.month)) {
    const spentNow = new Map(view.housing.map((r) => [r.name, r.spent]))
    for (const u of usualHousing(ix, view.month, plannedIds)) {
      const now = spentNow.get(u.name) ?? 0
      if (now >= u.typical / 2) continue
      const date = `${view.month}-${String(u.day).padStart(2, '0')}`
      const amount = u.typical - now
      // Part of it is in: one line, paid so far and about how much more.
      const line = paid.find((b) => b.name === u.name)
      if (line) line.more = { amount, date }
      else coming.push({ name: u.name, amount, date, status: 'usual' })
    }
  }

  paid.sort((a, b) => b.amount - a.amount)
  // By date; on the same day a known bill before an estimate.
  coming.sort(
    (a, b) =>
      (a.date ?? '').localeCompare(b.date ?? '') ||
      (a.status === 'due' ? -1 : 0) - (b.status === 'due' ? -1 : 0),
  )
  const sum = (l: Array<BillLine>) => l.reduce((n, b) => n + b.amount, 0)
  const more = paid.reduce((n, b) => n + (b.more?.amount ?? 0), 0)
  return {
    lines: [...paid, ...coming],
    paid: sum(paid),
    expected: sum(paid) + more + sum(coming),
  }
}

/**
 * Housing Categories that post in most recent months, for about the same
 * each month (a bill, not upkeep): what a month of each typically comes to and the day of the month it usually lands (the day of
 * its biggest purchase, middle of the months seen).
 */
export function usualHousing(
  ix: LedgerIndex,
  month: string,
  plannedIds: Set<string>,
): Array<{ name: string; typical: number; day: number }> {
  const window = new Set(monthRange(shiftMonth(month, -1), USUAL_MONTHS))
  const by = new Map<
    string,
    Map<string, { total: number; day: number; big: number }>
  >()
  for (const t of ix.ledger.txns) {
    if (!window.has(t.month) || plannedIds.has(t.id)) continue
    const name = categoryOf(ix, t)
    if (!isHousing(ix, name)) continue
    const months = by.get(name) ?? new Map()
    const m = months.get(t.month) ?? { total: 0, day: 1, big: -Infinity }
    m.total += t.amount
    if (t.amount > m.big) {
      m.big = t.amount
      m.day = Number(t.date.slice(8, 10))
    }
    months.set(t.month, m)
    by.set(name, months)
  }
  const out: Array<{ name: string; typical: number; day: number }> = []
  for (const [name, months] of by) {
    const seen = [...months.values()].filter((m) => m.total > 0)
    if (seen.length < REGULAR_MONTHS) continue
    const totals = seen.map((m) => m.total)
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length
    const spread = Math.sqrt(
      totals.reduce((n, t) => n + (t - mean) ** 2, 0) / totals.length,
    )
    if (spread / mean > STEADY) continue
    const days = seen.map((m) => m.day).sort((a, b) => a - b)
    const lastDay = Number(lastDayOf(month).slice(8, 10))
    out.push({
      name,
      typical: Math.round(seen.reduce((n, m) => n + m.total, 0) / seen.length),
      day: Math.min(days[Math.floor(days.length / 2)], lastDay),
    })
  }
  return out
}

export interface MonthPay {
  /** Take-home landing in the month, by its actual paydays. */
  amount: number
  paychecks: number
  /** The next payday after today, when there is one this month or later. */
  next: string | null
}

/** Take-home for one month by its paydays (some months have a third). */
export function monthPay(
  schedules: Array<PaySchedule>,
  month: string,
  today: string,
): MonthPay {
  let amount = 0
  let paychecks = 0
  for (const s of schedules) {
    const days = paydays(s, `${month}-01`, lastDayOf(month))
    paychecks += days.length
    amount += days.length * s.amount
  }
  const upcoming = schedules
    .flatMap((s) => paydays(s, today, shiftMonthEnd(today)))
    .filter((d) => d > today)
    .sort()
  return { amount, paychecks, next: upcoming[0] ?? null }
}

/** The last day of the month after `date`'s: far enough to find a payday. */
function shiftMonthEnd(date: string): string {
  return lastDayOf(shiftMonth(date.slice(0, 7), 1))
}
