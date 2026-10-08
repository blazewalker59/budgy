/**
 * A Selection of the Household's spending (a person, some Accounts, a
 * search) set against the whole and against the Budget: how much of each
 * Category it accounts for, which Accounts it comes from, and how it moves
 * month to month. Planned Expense payments are left out, as in the Budget.
 * Amounts are per month (averaged when the period spans several).
 */

import {
  categoryOf,
  categoryTag,
  isHousing,
  ownerOf,
  targetFor,
} from './ledger'
import type { LedgerIndex } from './ledger'
import type { Owner, Tag, Txn } from './types'

export interface Selection {
  owner?: Owner | null
  /** Only these Accounts; empty or missing means all. */
  accounts?: ReadonlyArray<string>
  /** Store, description or note contains this (any case). */
  q?: string
}

export function isSelecting(sel: Selection): boolean {
  return Boolean(sel.owner || sel.accounts?.length || sel.q?.trim())
}

export function inSelection(ix: LedgerIndex, t: Txn, sel: Selection): boolean {
  if (sel.owner && ownerOf(ix, t) !== sel.owner) return false
  if (sel.accounts?.length && !sel.accounts.includes(t.account)) return false
  const q = sel.q?.trim().toLowerCase()
  if (
    q &&
    !t.store.toLowerCase().includes(q) &&
    !t.description.toLowerCase().includes(q) &&
    !(t.note ?? '').toLowerCase().includes(q)
  )
    return false
  return true
}

export interface CategoryShare {
  name: string
  tag: Tag
  /** Everyone's everyday spending, per month. */
  total: number
  /** The Selection's part of it, per month. */
  selected: number
  /** The monthly Target (averaged over the period), if any. */
  target: number | null
}

export interface SourceShare {
  account: string
  owner: Owner
  amount: number
  /** In the Selection. */
  selected: boolean
}

export interface MonthShare {
  month: string
  total: number
  selected: number
}

export interface Breakdown {
  categories: Array<CategoryShare>
  sources: Array<SourceShare>
  months: Array<MonthShare>
  totals: {
    total: number
    selected: number
    /** All everyday Targets, per month. */
    target: number
    count: number
  }
}

export function breakdown(
  ix: LedgerIndex,
  months: Array<string>,
  sel: Selection,
  plannedIds: Set<string>,
): Breakdown {
  const n = months.length || 1
  const inPeriod = new Set(months)
  const cats = new Map<string, { total: number; selected: number }>()
  const sources = new Map<string, { amount: number; selected: boolean }>()
  const monthly = new Map(months.map((m) => [m, { total: 0, selected: 0 }]))
  let count = 0

  for (const t of ix.ledger.txns) {
    if (!inPeriod.has(t.month) || plannedIds.has(t.id)) continue
    const name = categoryOf(ix, t)
    if (isHousing(ix, name)) continue
    const picked = inSelection(ix, t, sel)
    const c = cats.get(name) ?? { total: 0, selected: 0 }
    c.total += t.amount
    if (picked) c.selected += t.amount
    cats.set(name, c)
    // Sources show the person's Accounts (all Accounts when no person).
    if (!sel.owner || ownerOf(ix, t) === sel.owner) {
      const s = sources.get(t.account) ?? { amount: 0, selected: false }
      s.amount += t.amount
      if (picked) s.selected = true
      sources.set(t.account, s)
    }
    const m = monthly.get(t.month)!
    m.total += t.amount
    if (picked) {
      m.selected += t.amount
      count++
    }
  }

  const perMonth = (cents: number) => Math.round(cents / n)
  const avgTarget = (name: string): number | null => {
    const ts = months.map((m) => targetFor(ix, name, m))
    if (ts.every((t) => t === null)) return null
    return Math.round(ts.reduce<number>((a, t) => a + (t ?? 0), 0) / n)
  }
  const everydayNames = new Set(
    [...ix.categories.values()]
      .filter((c) => c.group === 'everyday')
      .map((c) => c.name),
  )
  for (const name of ix.targets.keys())
    if (!isHousing(ix, name)) everydayNames.add(name)
  for (const name of cats.keys()) everydayNames.add(name)

  const categories = [...everydayNames]
    .map((name): CategoryShare => {
      const c = cats.get(name) ?? { total: 0, selected: 0 }
      return {
        name,
        tag: categoryTag(ix, name),
        total: perMonth(c.total),
        selected: perMonth(c.selected),
        target: avgTarget(name),
      }
    })
    .filter((c) => c.total > 0 || (c.target ?? 0) > 0)
    .sort(
      (a, b) =>
        b.selected - a.selected ||
        b.total - a.total ||
        a.name.localeCompare(b.name),
    )

  return {
    categories,
    sources: [...sources]
      .map(([account, s]) => ({
        account,
        owner: ix.owners.get(account) ?? 'Joint',
        amount: perMonth(s.amount),
        selected: s.selected,
      }))
      .filter((s) => s.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    months: months.map((month) => ({ month, ...monthly.get(month)! })),
    totals: {
      total: categories.reduce((a, c) => a + c.total, 0),
      selected: categories.reduce((a, c) => a + c.selected, 0),
      target: categories.reduce((a, c) => a + (c.target ?? 0), 0),
      count,
    },
  }
}
