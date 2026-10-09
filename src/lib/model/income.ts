/**
 * Take-home pay: what the Household can count on each month, for weighing
 * the Budget against. Each employer's usual paycheck times how often it
 * comes, so a month with a third biweekly check or a bonus doesn't inflate
 * it; everything else that came in (bonuses, refunds, gifts) is Other
 * income, averaged over the same months. Pure.
 */

import { daysBetween } from './dates'
import type { Income } from './types'

export interface PaySource {
  payer: string
  account: string
  /** The usual paycheck, in cents. */
  perCheck: number
  perYear: 52 | 26 | 24 | 12
  /** perCheck × perYear / 12. */
  monthly: number
  /** Regular paychecks in the window. */
  checks: number
  last: string
  /** No paycheck for two pay periods: left out of the monthly figure. */
  ended: boolean
}

export interface TakeHome {
  /** Regular pay per month, from the payers still paying. */
  monthly: number
  /** How `monthly` was found: from paychecks, or (none found) every deposit averaged. */
  basis: 'paychecks' | 'deposits' | 'none'
  sources: Array<PaySource>
  /** Everything else per month: bonuses, refunds, gifts, one-off pay. */
  other: number
  /** Everything received in each window month. */
  received: Array<number>
}

export const PAY_SCHEDULES: Record<PaySource['perYear'], string> = {
  52: 'weekly',
  26: 'every 2 weeks',
  24: 'twice a month',
  12: 'monthly',
}

const PAYCHECK = 'Paycheck'

function median(values: Array<number>): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function schedule(gapDays: number): PaySource['perYear'] | null {
  if (gapDays < 5 || gapDays > 45) return null
  if (gapDays <= 10) return 52
  if (gapDays <= 14.5) return 26
  if (gapDays <= 20) return 24
  return 12
}

export function takeHome(
  income: Array<Income>,
  window: Array<string>,
  today: string,
): TakeHome {
  const index = new Map(window.map((m, i) => [m, i]))
  const inWindow = income.filter((i) => index.has(i.month))
  const received = window.map(() => 0)
  for (const i of inWindow) received[index.get(i.month)!] += i.amount
  const total = received.reduce((a, b) => a + b, 0)

  const byPayer = new Map<string, Array<Income>>()
  for (const i of inWindow) {
    if (i.sourceCategory !== PAYCHECK) continue
    const list = byPayer.get(i.payer) ?? []
    list.push(i)
    byPayer.set(i.payer, list)
  }

  const sources: Array<PaySource> = []
  let regular = 0
  for (const [payer, list] of byPayer) {
    if (list.length < 3) continue
    list.sort((a, b) => (a.date < b.date ? -1 : 1))
    const gap = median(
      list.slice(1).map((x, k) => daysBetween(list[k].date, x.date)),
    )
    const perYear = schedule(gap)
    if (!perYear) continue
    const perCheck = median(list.map((x) => x.amount))
    // A bonus or a one-off paid by the same employer is Other income.
    const usual = list.filter(
      (x) => x.amount >= perCheck * 0.5 && x.amount <= perCheck * 1.5,
    )
    const last = list[list.length - 1].date
    regular += usual.reduce((s, x) => s + x.amount, 0)
    sources.push({
      payer,
      account: list[list.length - 1].account,
      perCheck,
      perYear,
      monthly: Math.round((perCheck * perYear) / 12),
      checks: usual.length,
      last,
      ended: daysBetween(last, today) > gap * 2 + 5,
    })
  }
  sources.sort(
    (a, b) => Number(a.ended) - Number(b.ended) || b.monthly - a.monthly,
  )

  const months = window.length || 1
  const paying = sources.filter((s) => !s.ended)
  if (paying.length)
    return {
      monthly: paying.reduce((s, p) => s + p.monthly, 0),
      basis: 'paychecks',
      sources,
      other: Math.max(0, Math.round((total - regular) / months)),
      received,
    }
  return {
    monthly: Math.round(total / months),
    basis: total > 0 ? 'deposits' : 'none',
    sources,
    other: 0,
    received,
  }
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
