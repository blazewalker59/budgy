/**
 * Purchases for one Account, from its uploaded export or posted by an Agent
 * (say, a day of Apple Card purchases it read itself), made into
 * Transactions: Store names, ids, and a Category from what each is given,
 * else where that Store's purchases usually go. A row matching one already
 * there on the same day and amount is left out, so the same purchase
 * arriving both ways isn't counted twice.
 *
 * Starting purchases being replaced (from the whole-household export Budgy
 * started from) hand their Store, Category, Move and note to the new row
 * for the same day and amount, so nothing filed on them moves.
 */

import { z } from 'zod'
import { sha1Hex, twoDecimals } from './rows'
import { EMPTY_RULES } from './rules'
import { bucketCategory, isSpending, storeName } from './stores'
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
  /** A posted connector transaction's stable ID, when one is available. */
  sourceId?: string
}

export const postedRowInput = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
    .refine((date) => {
      const parsed = new Date(`${date}T00:00:00Z`)
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date
      )
    }, 'A real calendar date is required'),
  description: z.string().trim().min(1).max(200),
  amount: z
    .number()
    .finite()
    .min(-1_000_000)
    .max(1_000_000)
    .describe('Dollars; positive is spending, negative a refund'),
  category: z.string().max(60).nullable().optional(),
  sourceId: z.string().min(1).max(200).optional(),
})

interface Filed {
  description: string
  store: string
  category: string
  how: 'replaced' | 'given' | 'store history' | 'uncategorized'
}

export interface Replaced {
  id: string
  date: string
  amount: number
  description: string
  store: string
  sourceCategory: string
  category: string | null
  note: string | null
}

export interface Prepared {
  fresh: Array<
    ParsedTxn & {
      filed: Filed['how']
      /** Carried from the starting purchase this one replaces. */
      category: string | null
      note: string | null
    }
  >
  /** Already in the Ledger by id. */
  alreadyHad: number
  /** Escrow payouts and the Household's investments. */
  notSpending: number
  /** Moves and notes carried over from replaced starting purchases. */
  carried: number
  /** Same Account, day and amount as one already there. */
  duplicates: Array<{
    date: string
    description: string
    amount: number
    existing: string
  }>
}

export interface Usual {
  /** The Store's name as the Ledger has it. */
  store: string
  category: string
}

/**
 * Each Store's most common import Category, so its Store Rules apply,
 * keyed by its name in any case ("BLUE DOOR GYM" is the Store
 * already called "Blue Door Gym").
 */
export function storeHistory(
  txns: Array<{ store: string; sourceCategory: string }>,
): Map<string, Usual> {
  const counts = new Map<string, Map<string, number>>()
  for (const t of txns) {
    const c = counts.get(t.store) ?? new Map<string, number>()
    c.set(t.sourceCategory, (c.get(t.sourceCategory) ?? 0) + 1)
    counts.set(t.store, c)
  }
  const out = new Map<string, Usual & { n: number }>()
  for (const [store, c] of counts) {
    const [category, n] = [...c].sort((a, b) => b[1] - a[1])[0]
    const key = store.toLowerCase()
    // Of two spellings, the one with more purchases names it.
    const had = out.get(key)
    if (!had || n > had.n) out.set(key, { store, category, n })
  }
  return new Map(
    [...out].map(([k, { store, category }]) => [k, { store, category }]),
  )
}

export async function preparePosted(input: {
  account: string
  rows: Array<PostedRow>
  categories: Array<string>
  history: Map<string, Usual>
  /** The Account's Transactions over the rows' dates. */
  existing: Array<{
    id: string
    date: string
    amount: number
    description: string
  }>
  /** Starting purchases these rows replace (left out of `existing`). */
  replacing?: Array<Replaced>
  rules?: ImportRules
  /** This Household's owners; any but Joint become "<name> personal". */
  owners?: ReadonlyArray<string>
}): Promise<Prepared> {
  const rules = input.rules ?? EMPTY_RULES
  const byName = new Map(input.categories.map((c) => [c.toLowerCase(), c]))
  const have = new Set(input.existing.map((t) => t.id))
  const sameDay = new Map<string, Array<string>>()
  for (const t of input.existing) {
    const k = `${t.date}|${t.amount}`
    sameDay.set(k, [...(sameDay.get(k) ?? []), t.description])
  }

  const replacing = new Map<string, Array<Replaced>>()
  for (const t of input.replacing ?? []) {
    const k = `${t.date}|${t.amount}`
    replacing.set(k, [...(replacing.get(k) ?? []), t])
  }

  const seen = new Map<string, number>()
  const out: Prepared = {
    fresh: [],
    alreadyHad: 0,
    notSpending: 0,
    carried: 0,
    duplicates: [],
  }
  for (const r of input.rows) {
    if (!isSpending(r.description, rules)) {
      out.notSpending++
      continue
    }
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
    // Same amount/day alone is not identity: two different stores can cost
    // the same. Keep one-to-one matching, but require a normalized Store too.
    const matchIndex =
      match?.findIndex(
        (description) =>
          storeName(description, rules).toLowerCase() ===
          storeName(r.description, rules).toLowerCase(),
      ) ?? -1
    if (match && matchIndex >= 0) {
      out.duplicates.push({
        date: r.date,
        description: r.description,
        amount: r.amount,
        existing: match.splice(matchIndex, 1)[0],
      })
      continue
    }
    const named = storeName(r.description, rules)
    const given = r.category
      ? byName.get(r.category.trim().toLowerCase())
      : undefined
    const usual = input.history.get(named.toLowerCase())
    // The one it replaces: same day and amount, the same description first.
    // It keeps that one's Store and Category, so nothing in its past moves.
    const olds = replacing.get(`${r.date}|${amount}`)
    const i = olds
      ? Math.max(
          0,
          olds.findIndex((o) => o.description === r.description),
        )
      : -1
    const old = olds && i >= 0 ? olds.splice(i, 1)[0] : undefined
    if (old && (old.category || old.note)) out.carried++
    const store = old?.store ?? usual?.store ?? named
    out.fresh.push({
      id,
      date: r.date,
      month: r.date.slice(0, 7),
      account: input.account,
      accountSource: input.account,
      description: r.description,
      store,
      sourceCategory:
        old?.sourceCategory ??
        given ??
        usual?.category ??
        bucketCategory(
          UNCATEGORIZED,
          r.description,
          store,
          rules,
          input.owners,
        ),
      amount,
      filed: old
        ? 'replaced'
        : given
          ? 'given'
          : usual
            ? 'store history'
            : 'uncategorized',
      category: old?.category ?? null,
      note: old?.note ?? null,
    })
  }
  return out
}
