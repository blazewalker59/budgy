/**
 * Budget Alerts: what a Member would want to hear about without asking.
 * A Category over its Target or on pace to be, the whole everyday Budget
 * on pace over, a Planned Expense coming due (or late), a large purchase,
 * and an Account whose imports stopped. Pure: from the Ledger and today.
 */

import {
  addDays,
  dayLabel,
  daysBetween,
  monthLabel,
  relativeDays,
} from './dates'
import { coverageGaps } from './coverage'
import { possibleDuplicates } from './duplicates'
import { categoryOf, ownerOf } from './ledger'
import { monthView, upcoming } from './month'
import { dollars } from './money'
import { setAside } from './plans'
import type { LedgerIndex } from './ledger'
import type { Occurrence } from './plans'

type AlertKind =
  | 'over-target'
  | 'on-pace-over'
  | 'budget-on-pace-over'
  | 'bill-due'
  | 'bill-late'
  | 'large-purchase'
  | 'missing-imports'
  | 'possible-duplicates'

type Severity = 'high' | 'medium' | 'info'

export interface Alert {
  kind: AlertKind
  severity: Severity
  title: string
  detail: string
  category?: string
  /** Cents the alert is about (overage, bill, purchase). */
  amount?: number
}

/** Bills due within this many days are worth a heads-up. */
const BILL_NOTICE_DAYS = 14
/** A single purchase this big (cents) in the last week is worth a mention. */
const LARGE_PURCHASE = 30_000
/** Pace alerts wait until this share of the month has gone, so day 2 isn't alarming. */
const PACE_FROM = 0.33

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, info: 2 }

export function budgetAlerts(
  ix: LedgerIndex,
  today: string,
  occurrences: Array<Occurrence>,
): Array<Alert> {
  const month = today.slice(0, 7)
  const view = monthView(ix, month, today, null, occurrences)
  const out: Array<Alert> = []

  for (const r of view.everyday) {
    if (r.target === null || r.target <= 0) continue
    if (r.spent > r.target) {
      const over = r.spent - r.target
      out.push({
        kind: 'over-target',
        severity: over > r.target * 0.1 || over > 5_000 ? 'high' : 'medium',
        title: `${r.name} is over its Target`,
        detail: `${dollars(r.spent)} spent of ${dollars(r.target)} in ${monthLabel(month)}. ${dollars(r.spent - r.target)} over.`,
        category: r.name,
        amount: r.spent - r.target,
      })
    } else if (
      view.elapsed < 1 &&
      // One early bill isn't a pace: wait for a few purchases, or mid-month.
      ((r.txns.length >= 3 && view.elapsed >= PACE_FROM) || view.elapsed >= 0.5)
    ) {
      const projected = Math.round(r.spent / view.elapsed)
      if (projected > r.target * 1.1 && r.spent > r.target * 0.5)
        out.push({
          kind: 'on-pace-over',
          severity: 'medium',
          title: `${r.name} is on pace to go over`,
          detail: `${dollars(r.spent)} of ${dollars(r.target)} spent, ${Math.round((1 - view.elapsed) * 100)}% of the month left. On pace for about ${dollars(projected)}.`,
          category: r.name,
          amount: projected - r.target,
        })
    }
  }

  const t = view.totals
  if (t.target > 0 && view.elapsed >= PACE_FROM && view.elapsed < 1) {
    const projected = Math.round(t.spent / view.elapsed)
    if (projected > t.target * 1.05)
      out.push({
        kind: 'budget-on-pace-over',
        severity: projected > t.target * 1.15 ? 'high' : 'medium',
        title: 'Everyday spending is on pace to go over the Budget',
        detail: `${dollars(t.spent)} of ${dollars(t.target)} so far. On pace for about ${dollars(projected)} by month end.`,
        amount: projected - t.target,
      })
  }

  for (const o of upcoming(
    occurrences,
    today,
    addDays(today, BILL_NOTICE_DAYS),
  )) {
    const late = o.due < today
    out.push({
      kind: late ? 'bill-late' : 'bill-due',
      severity: late
        ? 'high'
        : daysBetween(today, o.due) <= 3
          ? 'medium'
          : 'info',
      title: late
        ? `${o.plan.name} hasn’t shown up yet`
        : `${o.plan.name} is due ${relativeDays(today, o.due)}`,
      detail: late
        ? `${dollars(o.plan.amount)} was due ${dayLabel(o.due)}. No matching payment yet.`
        : `About ${dollars(o.plan.amount)} due ${dayLabel(o.due)} (${o.plan.category}). ${setAside(o.plan) ? 'Planned, so it’s not in the everyday Budget.' : 'It counts toward the target.'}`,
      category: o.plan.category,
      amount: o.plan.amount,
    })
  }

  // Any planned bill's payment was expected, monthly ones included.
  const bills = new Set(occurrences.flatMap((o) => o.paidBy?.id ?? []))
  const weekAgo = addDays(today, -7)
  for (const tx of ix.ledger.txns) {
    if (tx.date < weekAgo || tx.date > today || tx.amount < LARGE_PURCHASE)
      continue
    if (bills.has(tx.id)) continue
    const category = categoryOf(ix, tx)
    if (ix.categories.get(category)?.group === 'housing') continue
    out.push({
      kind: 'large-purchase',
      severity: 'info',
      title: `Large purchase: ${dollars(tx.amount)} at ${tx.store}`,
      detail: `${dayLabel(tx.date)} on ${tx.account} (${ownerOf(ix, tx)}), in ${category}.`,
      category,
      amount: tx.amount,
    })
  }

  for (const g of coverageGaps(ix, month, today))
    out.push({
      kind: 'missing-imports',
      severity: 'medium',
      title: `${g.account} looks out of date`,
      detail: `Nothing since ${g.last ? dayLabel(g.last) : 'the start of the month'}. Recent spending may be low. Upload a newer export.`,
    })

  const duplicates = possibleDuplicates(ix).length
  if (duplicates)
    out.push({
      kind: 'possible-duplicates',
      severity: 'medium',
      title:
        duplicates === 1
          ? 'A purchase may be here twice'
          : `${duplicates} purchases may be here twice`,
      detail:
        'Spending may be counted twice. Review them on Accounts → Updates.',
    })

  return out.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (b.amount ?? 0) - (a.amount ?? 0),
  )
}
