/**
 * Pace: a month's everyday spending adding up day by day, against the
 * Budget's even pace and against what the months before had spent by the
 * same point. Everyday is as Overview counts it (monthView): no Housing and
 * no set-aside Planned Expense payments.
 */

import { monthView } from './month'
import { daysInMonth, shiftMonth } from './dates'
import type { MonthView } from './month'
import type { LedgerIndex } from './ledger'
import type { Occurrence } from './plans'

/** Months before this one that make "usual". */
const PACE_HISTORY = 6

/** Spent by one day of the month, across the months that make "usual". */
export interface UsualDay {
  /** 20th percentile. */
  low: number
  median: number
  /** 80th percentile. */
  high: number
}

export interface MonthPace {
  /** Everyday spent on each day, cents; index 0 is the 1st. */
  daily: Array<number>
  /** Running total of `daily`. */
  total: Array<number>
  /** Today's index: the last day for a past month, -1 for a future one. */
  today: number
  /** By day, stretched to this month's length; null with no history. */
  usual: Array<UsualDay> | null
  /** How many earlier months `usual` comes from. */
  months: number
  /** The everyday Budget for the month. */
  target: number
  /** Spent by today. */
  spent: number
  /** Over (+) or under (−) the Budget's even pace, by today. */
  overPace: number
  /** Above (+) or below (−) the usual median, by today; null with no history. */
  vsUsual: number | null
}

/** Everyday spending on each day of the view's month, cents. */
export function dailySpend(view: MonthView): Array<number> {
  const [y, m] = view.month.split('-').map(Number)
  const daily = new Array<number>(daysInMonth(y, m)).fill(0)
  for (const c of view.everyday)
    for (const t of c.txns) daily[Number(t.date.slice(8, 10)) - 1] += t.amount
  return daily
}

/** How many steps of shade a day of spending can take (0 is none). */
export const SPEND_LEVELS = 5

/**
 * Each day's step of shade, 0 for no spending and then 1 to SPEND_LEVELS
 * by where it ranks among the days with spending, so the steps share the
 * days about evenly and read apart. Equal amounts share a step.
 */
export function spendLevels(daily: ReadonlyArray<number>): Array<number> {
  const spent = daily.filter((d) => d > 0).sort((a, b) => a - b)
  return daily.map((d) => {
    if (d <= 0) return 0
    // Days below this one, as a share of the rest: 0 for the least, 1 for the most.
    const below = spent.findIndex((s) => s >= d)
    const share = spent.length > 1 ? below / (spent.length - 1) : 1
    return Math.min(SPEND_LEVELS, 1 + Math.floor(share * SPEND_LEVELS))
  })
}

function runningTotal(daily: Array<number>): Array<number> {
  let sum = 0
  return daily.map((d) => (sum += d))
}

/** The value at a share of the way through a sorted list (nearest rank). */
function percentile(sorted: Array<number>, p: number): number {
  return sorted[Math.round(p * (sorted.length - 1))] ?? 0
}

export function monthPace(
  ix: LedgerIndex,
  view: MonthView,
  today: string,
  occurrences: Array<Occurrence>,
  history = PACE_HISTORY,
): MonthPace {
  const daily = dailySpend(view)
  const total = runningTotal(daily)
  const days = daily.length
  const month = view.month
  const todayIndex =
    today.slice(0, 7) === month
      ? Number(today.slice(8, 10)) - 1
      : today.slice(0, 7) > month
        ? days - 1
        : -1

  // Earlier months with any everyday spending, each stretched to this
  // month's length so day 15 of 30 lines up with day 15 of 31.
  const earlier = Array.from({ length: history }, (_, i) =>
    runningTotal(
      dailySpend(
        monthView(ix, shiftMonth(month, -(i + 1)), today, null, occurrences),
      ),
    ),
  ).filter((t) => t[t.length - 1] > 0)
  const stretched = (t: Array<number>, day: number) =>
    t[Math.round(((day + 1) / days) * t.length) - 1] ?? 0
  const usual = earlier.length
    ? Array.from({ length: days }, (_, day) => {
        const by = earlier.map((t) => stretched(t, day)).sort((a, b) => a - b)
        return {
          low: percentile(by, 0.2),
          median: percentile(by, 0.5),
          high: percentile(by, 0.8),
        }
      })
    : null

  const target = view.totals.target
  const spent = todayIndex >= 0 ? total[todayIndex] : 0
  return {
    daily,
    total,
    today: todayIndex,
    usual,
    months: earlier.length,
    target,
    spent,
    overPace:
      todayIndex >= 0
        ? spent - Math.round((target * (todayIndex + 1)) / days)
        : 0,
    vsUsual: usual && todayIndex >= 0 ? spent - usual[todayIndex].median : null,
  }
}
