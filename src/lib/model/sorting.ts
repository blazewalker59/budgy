/**
 * Spending still to sort: purchases that came in Uncategorized, by Store,
 * the most money first. Filing a Store (a store-wide Store Rule) sorts all
 * of its purchases at once. Pure.
 */

import { categoryOf } from './ledger'
import type { LedgerIndex } from './ledger'
import type { Txn } from './types'

export const UNCATEGORIZED = 'Uncategorized'

export interface UnsortedStore {
  store: string
  purchases: number
  /** Cents. */
  spent: number
  /** Its newest purchase. */
  last: string
}

export function isUnsorted(ix: LedgerIndex, t: Txn): boolean {
  return categoryOf(ix, t) === UNCATEGORIZED
}

/** Stores with Uncategorized purchases, the most spent first. */
export function unsortedStores(ix: LedgerIndex): Array<UnsortedStore> {
  const byStore = new Map<string, UnsortedStore>()
  for (const t of ix.ledger.txns) {
    if (!isUnsorted(ix, t)) continue
    const key = t.store.toLowerCase()
    const s = byStore.get(key) ?? {
      store: t.store,
      purchases: 0,
      spent: 0,
      last: t.date,
    }
    s.purchases++
    s.spent += t.amount
    if (t.date > s.last) s.last = t.date
    byStore.set(key, s)
  }
  return [...byStore.values()].sort(
    (a, b) =>
      b.spent - a.spent ||
      b.purchases - a.purchases ||
      a.store.localeCompare(b.store),
  )
}

/** How many purchases are Uncategorized, of how many. */
export function unsortedShare(ix: LedgerIndex): {
  unsorted: number
  purchases: number
} {
  let unsorted = 0
  for (const t of ix.ledger.txns) if (isUnsorted(ix, t)) unsorted++
  return { unsorted, purchases: ix.ledger.txns.length }
}
