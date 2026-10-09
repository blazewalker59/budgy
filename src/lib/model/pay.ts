/**
 * Take-home pay, from the Pay Schedules the Household entered: each
 * paycheck times how often it comes (every 2 weeks is 26 a year), so a
 * month with a third paycheck doesn't move what the Budget is weighed
 * against. Pure.
 */

import { z } from 'zod'
import { addDays, daysBetween, daysInMonth, shiftMonth } from './dates'
import { PAYCHECKS_PER_YEAR, PAY_CADENCES } from './types'
import type { PaySchedule } from './types'

/** A Pay Schedule as a Member entered it; twice a month defaults to the last day. */
export const payInput = z
  .object({
    id: z.string().regex(/^ps_[a-z0-9]{6,24}$/),
    name: z.string().trim().min(1).max(60),
    amount: z.number().int().min(1).max(100_000_000),
    cadence: z
      .enum(PAY_CADENCES as [string, ...Array<string>])
      .transform((c) => c as PaySchedule['cadence']),
    anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    secondDay: z.number().int().min(1).max(31).nullable(),
  })
  .transform((p): PaySchedule => ({
    ...p,
    secondDay: p.cadence === 'semimonthly' ? (p.secondDay ?? 31) : null,
  }))

/** One Pay Schedule's paycheck averaged over the months of a year. */
export function monthlyPay(s: PaySchedule): number {
  return Math.round((s.amount * PAYCHECKS_PER_YEAR[s.cadence]) / 12)
}

function dayIn(month: string, day: number): string {
  const max = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))
  return `${month}-${String(Math.min(day, max)).padStart(2, '0')}`
}

/** Every payday from `from` through `to` (YYYY-MM-DD), in order. */
export function paydays(
  s: PaySchedule,
  from: string,
  to: string,
): Array<string> {
  const out: Array<string> = []
  if (s.cadence === 'weekly' || s.cadence === 'biweekly') {
    const step = s.cadence === 'weekly' ? 7 : 14
    const k = Math.ceil(daysBetween(s.anchor, from) / step)
    for (let d = addDays(s.anchor, k * step); d <= to; d = addDays(d, step))
      out.push(d)
    return out
  }
  const days = [Number(s.anchor.slice(8, 10))]
  if (s.cadence === 'semimonthly') days.push(s.secondDay ?? 31)
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1))
    for (const d of [...new Set(days.map((day) => dayIn(m, day)))].sort())
      if (d >= from && d <= to) out.push(d)
  return out
}

export interface TakeHome {
  /** Take-home per month, every Pay Schedule together. */
  monthly: number
  schedules: Array<{ schedule: PaySchedule; monthly: number; next: string }>
}

export function takeHome(
  schedules: Array<PaySchedule>,
  today: string,
): TakeHome {
  const rows = schedules.map((schedule) => ({
    schedule,
    monthly: monthlyPay(schedule),
    next: paydays(schedule, today, addDays(today, 62))[0] ?? today,
  }))
  return {
    monthly: rows.reduce((n, r) => n + r.monthly, 0),
    schedules: rows.sort((a, b) => b.monthly - a.monthly),
  }
}

/** What the Pay Schedules pay in each month: a third paycheck shows here. */
export function payByMonth(
  schedules: Array<PaySchedule>,
  months: Array<string>,
): Array<number> {
  return months.map((m) =>
    schedules.reduce(
      (n, s) => n + paydays(s, `${m}-01`, dayIn(m, 31)).length * s.amount,
      0,
    ),
  )
}

/** `part` as a whole percent of `whole`, or null without a whole. */
export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

export type SplitPart = 'everyday' | 'housing' | 'planned'

export interface IncomeSplit {
  /** Each part as an amount and a share of take-home pay. */
  parts: Array<{ part: SplitPart; amount: number; share: number }>
  spent: number
  /** Take-home minus spending; negative when spending more than comes in. */
  left: number
  /** Spending as a share of take-home (above 1 when over). */
  spentShare: number
}

/** How much of take-home pay each part of the Budget takes, and what's left. */
export function incomeSplit(
  income: number,
  amounts: Record<SplitPart, number>,
): IncomeSplit {
  const order: Array<SplitPart> = ['everyday', 'housing', 'planned']
  const share = (n: number) => (income > 0 ? n / income : 0)
  const spent = order.reduce((s, p) => s + amounts[p], 0)
  return {
    parts: order.map((part) => ({
      part,
      amount: amounts[part],
      share: share(amounts[part]),
    })),
    spent,
    left: income - spent,
    spentShare: share(spent),
  }
}
