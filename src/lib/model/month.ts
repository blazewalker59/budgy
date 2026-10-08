/**
 * One month against the Budget: what each Category spent next to its
 * Target, the Planned Expenses due, and the biggest Stores. Planned
 * Expenses are kept out of the everyday numbers (docs/adr/0002), so a car
 * insurance bill never reads as a blown Insurance budget.
 */

import { addDays, lastDayOf } from './dates'
import {
  categoryOf,
  categoryTag,
  isHousing,
  ownerOf,
  targetFor,
} from './ledger'
import { matchWindowDays } from './plans'
import type { LedgerIndex } from './ledger'
import type { Occurrence } from './plans'
import type { Group, Owner, Tag, Txn } from './types'

export interface CategoryMonth {
  name: string
  tag: Tag
  group: Group
  target: number | null
  /** Everyday spending: everything but Planned Expense payments. */
  spent: number
  txns: Array<Txn>
  planned: Array<Occurrence>
  plannedPaid: number
  plannedLeft: number
}

export interface StoreMonth {
  store: string
  amount: number
  txns: Array<Txn>
}

export interface MonthView {
  month: string
  everyday: Array<CategoryMonth>
  housing: Array<CategoryMonth>
  totals: {
    target: number
    spent: number
    /** Spent in Categories that aren't Needs: where choices show. */
    flexibleSpent: number
    flexibleTarget: number
    plannedPaid: number
    plannedLeft: number
  }
  stores: Array<StoreMonth>
  /** Share of the month gone, 0–1; 1 for past months. */
  elapsed: number
}

export function monthTxns(
  ix: LedgerIndex,
  month: string,
  owner: Owner | null,
): Array<Txn> {
  return ix.ledger.txns
    .filter((t) => t.month === month && (!owner || ownerOf(ix, t) === owner))
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
}

export function monthView(
  ix: LedgerIndex,
  month: string,
  today: string,
  owner: Owner | null,
  occurrences: Array<Occurrence>,
): MonthView {
  const plannedIds = new Set<string>()
  const due = owner
    ? []
    : occurrences.filter((o) => o.due.slice(0, 7) === month)
  for (const o of occurrences) if (o.paidBy) plannedIds.add(o.paidBy.id)

  const rows = new Map<string, CategoryMonth>()
  const row = (name: string): CategoryMonth => {
    let r = rows.get(name)
    if (!r) {
      r = {
        name,
        tag: categoryTag(ix, name),
        group: isHousing(ix, name) ? 'housing' : 'everyday',
        target: targetFor(ix, name, month),
        spent: 0,
        txns: [],
        planned: [],
        plannedPaid: 0,
        plannedLeft: 0,
      }
      rows.set(name, r)
    }
    return r
  }

  const stores = new Map<string, StoreMonth>()
  for (const t of monthTxns(ix, month, owner)) {
    if (plannedIds.has(t.id)) continue
    const r = row(categoryOf(ix, t))
    r.spent += t.amount
    r.txns.push(t)
    if (r.group === 'everyday') {
      const s = stores.get(t.store) ?? { store: t.store, amount: 0, txns: [] }
      s.amount += t.amount
      s.txns.push(t)
      stores.set(t.store, s)
    }
  }
  for (const o of due) {
    const r = row(o.plan.category)
    r.planned.push(o)
    if (o.paidBy) r.plannedPaid += o.paidBy.amount
    else r.plannedLeft += o.plan.amount
  }
  // Everyday Categories with a Target show even before anything is spent.
  for (const name of ix.targets.keys())
    if (!isHousing(ix, name) && targetFor(ix, name, month) !== null) row(name)

  const all = [...rows.values()]
  const bySize = (a: CategoryMonth, b: CategoryMonth) =>
    b.spent +
      b.plannedPaid +
      b.plannedLeft -
      (a.spent + a.plannedPaid + a.plannedLeft) || a.name.localeCompare(b.name)
  const everyday = all.filter((r) => r.group === 'everyday').sort(bySize)
  const housing = all.filter((r) => r.group === 'housing').sort(bySize)

  const sum = (list: Array<CategoryMonth>, f: (r: CategoryMonth) => number) =>
    list.reduce((n, r) => n + f(r), 0)
  const flexible = everyday.filter((r) => r.tag !== 'need')

  const last = lastDayOf(month)
  const first = `${month}-01`
  const elapsed =
    today > last
      ? 1
      : today < first
        ? 0
        : Number(today.slice(8, 10)) / Number(last.slice(8, 10))

  return {
    month,
    everyday,
    housing,
    totals: {
      target: sum(everyday, (r) => r.target ?? 0),
      spent: sum(everyday, (r) => r.spent),
      flexibleSpent: sum(flexible, (r) => r.spent),
      flexibleTarget: sum(flexible, (r) => r.target ?? 0),
      plannedPaid: sum(all, (r) => r.plannedPaid),
      plannedLeft: sum(all, (r) => r.plannedLeft),
    },
    stores: [...stores.values()]
      .filter((s) => s.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    elapsed,
  }
}

/**
 * Unpaid Planned Expenses due from a little before `today` (a payment can
 * land late) through `until`: what is coming that hasn't hit yet.
 */
export function upcoming(
  occurrences: Array<Occurrence>,
  today: string,
  until: string,
): Array<Occurrence> {
  return occurrences.filter(
    (o) =>
      !o.paidBy &&
      o.due <= until &&
      o.due >= addDays(today, -matchWindowDays(o.plan)),
  )
}

/**
 * Average everyday spending per Category per month over `months`, without
 * Planned Expense payments: a fair starting Target.
 */
export function averages(
  ix: LedgerIndex,
  months: Array<string>,
  plannedIds: Set<string>,
  owner: Owner | null = null,
): Map<string, { everyday: number; all: number }> {
  const inRange = new Set(months)
  const out = new Map<string, { everyday: number; all: number }>()
  for (const t of ix.ledger.txns) {
    if (!inRange.has(t.month)) continue
    if (owner && ownerOf(ix, t) !== owner) continue
    const name = categoryOf(ix, t)
    const a = out.get(name) ?? { everyday: 0, all: 0 }
    a.all += t.amount
    if (!plannedIds.has(t.id)) a.everyday += t.amount
    out.set(name, a)
  }
  for (const a of out.values()) {
    a.everyday = Math.round(a.everyday / months.length)
    a.all = Math.round(a.all / months.length)
  }
  return out
}
