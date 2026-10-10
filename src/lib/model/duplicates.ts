/**
 * Possible duplicates: one purchase here twice. Same Account, same amount,
 * within a few days, and either from two different sources under different
 * names (a sync's "ACH PMT NEWREZ-SHELLPOINT" beside an upload's
 * "Shellpoint", or an Agent's "Openai *chatgpt Subscr" beside the starting
 * export's "ChatGPT"), or the very same row twice. Merging keeps one;
 * keeping both remembers the answer.
 */

import { everyTxn } from './ledger'
import type { LedgerIndex } from './ledger'
import type { Txn } from './types'

/** How far apart the two dates can be (the sync's own matching window). */
export const DUPLICATE_DAYS = 3

export interface DuplicatePair {
  /** The one a merge removes. */
  goes: Txn
  /** The one a merge keeps: the one the next update will know. */
  stays: Txn
  key: string
}

/** The same two purchases in either order. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

type Source = Pick<Txn, 'starting' | 'synced'>

/**
 * Of two copies, the one that stays is the one the next update will know:
 * an Account's own upload or sync over a starting purchase, and an upload
 * over a sync (it takes the bank's ID, so both know it).
 */
export function staysFirst(a: Source, b: Source): boolean {
  if (!a.starting !== !b.starting) return !a.starting
  return !a.synced || !!b.synced
}

/** A merged purchase keeps a starting purchase's Store and filing. */
export function filedFirst(stays: Source, goes: Source): boolean {
  return !goes.starting || !!stays.starting
}

const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
  86_400_000

const words = (t: Txn) =>
  new Set(
    `${t.store} ${t.description}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  )

const sharesAWord = (a: Txn, b: Txn) => {
  const wa = words(a)
  return [...words(b)].some((w) => wa.has(w))
}

function candidate(a: Txn, b: Txn): boolean {
  // The bank knows two of its own apart.
  if (a.synced && b.synced) return false
  if (!a.starting !== !b.starting || !a.synced !== !b.synced) return true
  return a.date === b.date && a.description === b.description
}

export function possibleDuplicates(ix: LedgerIndex): Array<DuplicatePair> {
  const kept = new Set(ix.ledger.kept)
  const groups = new Map<string, Array<Txn>>()
  for (const t of everyTxn(ix)) {
    const k = `${t.account}\u0000${t.amount}`
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  const found: Array<{ a: Txn; b: Txn; days: number; alike: boolean }> = []
  for (const group of groups.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]]
        const days = daysApart(a.date, b.date)
        if (
          days <= DUPLICATE_DAYS &&
          candidate(a, b) &&
          !kept.has(pairKey(a.id, b.id))
        )
          found.push({ a, b, days, alike: sharesAWord(a, b) })
      }
  // Nearest first, then the ones that share a name; one pair per purchase.
  found.sort((x, y) => x.days - y.days || Number(y.alike) - Number(x.alike))
  const used = new Set<string>()
  const out: Array<DuplicatePair> = []
  for (const { a, b } of found) {
    if (used.has(a.id) || used.has(b.id)) continue
    used.add(a.id)
    used.add(b.id)
    const [stays, goes] = staysFirst(a, b) ? [a, b] : [b, a]
    out.push({ goes, stays, key: pairKey(a.id, b.id) })
  }
  return out.sort(
    (a, b) =>
      b.stays.date.localeCompare(a.stays.date) || a.key.localeCompare(b.key),
  )
}
