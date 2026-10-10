/**
 * Possible duplicates: a purchase a bank sync added that was already here
 * from an upload, under another name ("ACH PMT NEWREZ-SHELLPOINT" beside
 * "Shellpoint"). Same Account, same amount, within a few days. Merging
 * keeps the one already here; keeping both remembers the answer.
 */

import { everyTxn } from './ledger'
import type { LedgerIndex } from './ledger'
import type { Txn } from './types'

/** How far apart the two dates can be (the sync's own matching window). */
export const DUPLICATE_DAYS = 3

export interface DuplicatePair {
  /** The one the sync added. */
  synced: Txn
  /** The one already here, which a merge keeps. */
  other: Txn
  key: string
}

/** The same two purchases in either order. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
  86_400_000

export function possibleDuplicates(ix: LedgerIndex): Array<DuplicatePair> {
  const kept = new Set(ix.ledger.kept)
  const unsynced = new Map<string, Array<Txn>>()
  const synced: Array<Txn> = []
  for (const t of everyTxn(ix)) {
    if (t.synced) synced.push(t)
    else {
      const k = `${t.account}\u0000${t.amount}`
      unsynced.set(k, [...(unsynced.get(k) ?? []), t])
    }
  }
  const used = new Set<string>()
  const out: Array<DuplicatePair> = []
  for (const s of synced.sort((a, b) => a.date.localeCompare(b.date))) {
    const match = (unsynced.get(`${s.account}\u0000${s.amount}`) ?? [])
      .filter(
        (t) =>
          !used.has(t.id) &&
          daysApart(t.date, s.date) <= DUPLICATE_DAYS &&
          !kept.has(pairKey(s.id, t.id)),
      )
      .sort((a, b) => daysApart(a.date, s.date) - daysApart(b.date, s.date))[0]
    if (!match) continue
    used.add(match.id)
    out.push({ synced: s, other: match, key: pairKey(s.id, match.id) })
  }
  return out.sort((a, b) => b.synced.date.localeCompare(a.synced.date))
}
