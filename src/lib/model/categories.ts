/**
 * Categories as a Member keeps them: renamed everywhere at once, hidden
 * from pickers and the Budget (their purchases still count), or deleted
 * when nothing names them. Pure; the server does the same in D1
 * (src/lib/ledger/categories.ts).
 */

import { allCategoryNames } from './ledger'
import type { LedgerIndex } from './ledger'
import type { Ledger } from './types'

export function isHidden(ix: LedgerIndex, name: string): boolean {
  return ix.categories.get(name)?.hidden === true
}

/** Category names to offer in a picker: every one in use, hidden aside. */
export function pickableCategoryNames(ix: LedgerIndex): Array<string> {
  return allCategoryNames(ix).filter((n) => !isHidden(ix, n))
}

/** How many Ledger rows name a Category; zero means it can be deleted. */
export function categoryUseCount(ledger: Ledger, name: string): number {
  return (
    ledger.txns.filter((t) => t.category === name || t.sourceCategory === name)
      .length +
    ledger.rules.filter((r) => r.category === name || r.sourceCategory === name)
      .length +
    ledger.targets.filter((t) => t.category === name).length +
    ledger.plans.filter((p) => p.category === name).length
  )
}

/** The Ledger with a Category renamed in every row that names it. */
export function renamedLedger(l: Ledger, from: string, to: string): Ledger {
  if (!to || from === to) return l
  const swap = (name: string) => (name === from ? to : name)
  const suffix = `|${from}`
  return {
    ...l,
    categories: l.categories.map((c) =>
      c.name === from ? { ...c, name: to } : c,
    ),
    txns: l.txns.map((t) =>
      t.category === from || t.sourceCategory === from
        ? {
            ...t,
            category: t.category === from ? to : t.category,
            sourceCategory: swap(t.sourceCategory),
          }
        : t,
    ),
    rules: l.rules.map((r) =>
      r.category === from || r.sourceCategory === from
        ? {
            ...r,
            category: r.category === from ? to : r.category,
            sourceCategory: swap(r.sourceCategory),
          }
        : r,
    ),
    targets: l.targets.map((t) =>
      t.category === from ? { ...t, category: to } : t,
    ),
    plans: l.plans.map((p) =>
      p.category === from ? { ...p, category: to } : p,
    ),
    lenses: l.lenses.map((s) =>
      s.lens.categories?.includes(from)
        ? {
            ...s,
            lens: {
              ...s.lens,
              categories: [...new Set(s.lens.categories.map(swap))],
            },
          }
        : s,
    ),
    dismissed: l.dismissed.map((k) =>
      k.endsWith(suffix) ? `${k.slice(0, -suffix.length)}|${to}` : k,
    ),
  }
}
