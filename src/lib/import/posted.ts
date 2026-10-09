/**
 * Purchases an Agent posts for one Account (say, a day of Apple Card
 * purchases it read itself), made into Transactions the way an export's
 * rows are: the same Store names and ids. Each is filed by what it's
 * given, else by where that Store's purchases usually go. A row matching
 * one already there on the same day and amount is left out, so the same
 * purchase arriving by export too isn't counted twice.
 */

import { sha1Hex, twoDecimals } from './rows'
import { EMPTY_RULES } from './rules'
import { storeName } from './stores'
import type { ParsedTxn } from './rows'
import type { ImportRules } from './rules'

export const UNCATEGORIZED = 'Uncategorized'

export interface PostedRow {
  date: string
  description: string
  /** Dollars; positive is spending, negative a refund. */
  amount: number
  /** A Category's name; otherwise the Store's usual one is used. */
  category?: string | null
}

export interface Filed {
  description: string
  store: string
  category: string
  how: 'given' | 'store history' | 'uncategorized'
}

export interface Prepared {
  fresh: Array<ParsedTxn & { filed: Filed['how'] }>
  /** Already in the Ledger by id. */
  alreadyHad: number
  /** Same Account, day and amount as one already there. */
  duplicates: Array<{
    date: string
    description: string
    amount: number
    existing: string
  }>
}

/** Each Store's most common import Category, so its Store Rules apply. */
export function storeHistory(
  txns: Array<{ store: string; sourceCategory: string }>,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const t of txns) {
    const c = counts.get(t.store) ?? new Map<string, number>()
    c.set(t.sourceCategory, (c.get(t.sourceCategory) ?? 0) + 1)
    counts.set(t.store, c)
  }
  const out = new Map<string, string>()
  for (const [store, c] of counts)
    out.set(store, [...c].sort((a, b) => b[1] - a[1])[0][0])
  return out
}

export async function preparePosted(input: {
  account: string
  rows: Array<PostedRow>
  categories: Array<string>
  history: Map<string, string>
  /** The Account's Transactions over the rows' dates. */
  existing: Array<{
    id: string
    date: string
    amount: number
    description: string
  }>
  rules?: ImportRules
}): Promise<Prepared> {
  const rules = input.rules ?? EMPTY_RULES
  const byName = new Map(input.categories.map((c) => [c.toLowerCase(), c]))
  const have = new Set(input.existing.map((t) => t.id))
  const sameDay = new Map<string, Array<string>>()
  for (const t of input.existing) {
    const k = `${t.date}|${t.amount}`
    sameDay.set(k, [...(sameDay.get(k) ?? []), t.description])
  }

  const seen = new Map<string, number>()
  const out: Prepared = { fresh: [], alreadyHad: 0, duplicates: [] }
  for (const r of input.rows) {
    const base = `${r.date}|${input.account}|${r.description}|${twoDecimals(r.amount)}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const id = (await sha1Hex(`${base}|${n}`)).slice(0, 10)
    const amount = Math.round(r.amount * 100)
    const match = sameDay.get(`${r.date}|${amount}`)
    if (have.has(id)) {
      // That purchase is accounted for; it can't also match another row.
      const i = match?.indexOf(r.description) ?? -1
      if (i >= 0) match!.splice(i, 1)
      out.alreadyHad++
      continue
    }
    if (match?.length) {
      out.duplicates.push({
        date: r.date,
        description: r.description,
        amount: r.amount,
        existing: match.shift()!,
      })
      continue
    }
    const store = storeName(r.description, rules)
    const given = r.category
      ? byName.get(r.category.trim().toLowerCase())
      : undefined
    const usual = input.history.get(store)
    out.fresh.push({
      id,
      date: r.date,
      month: r.date.slice(0, 7),
      account: input.account,
      accountSource: input.account,
      description: r.description,
      store,
      sourceCategory: given ?? usual ?? UNCATEGORIZED,
      amount,
      filed: given ? 'given' : usual ? 'store history' : 'uncategorized',
    })
  }
  return out
}
