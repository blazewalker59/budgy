/**
 * Store Rules as a Member manages them: what each one files, and the rules
 * worth making from Moves already made (a Store Moved to the same Category
 * again and again should be filed there every time).
 */

import { ANY_SOURCE, categoryOf, ruleFor, ruleKey } from './ledger'
import type { LedgerIndex } from './ledger'
import type { StoreRule } from './types'

export interface RuleUse {
  rule: StoreRule
  /** Purchases it files (Moves aside). */
  purchases: number
  /** The newest of them. */
  last: string | null
}

/** Every Store Rule with how much it files, Stores A–Z. */
export function ruleUses(ix: LedgerIndex): Array<RuleUse> {
  const uses = new Map<StoreRule, RuleUse>()
  for (const rule of ix.ledger.rules)
    uses.set(rule, { rule, purchases: 0, last: null })
  for (const t of ix.ledger.txns) {
    if (t.category) continue
    const rule = ruleFor(ix, t)
    const use = rule && uses.get(rule)
    if (!use) continue
    use.purchases++
    if (!use.last || t.date > use.last) use.last = t.date
  }
  return [...uses.values()].sort(
    (a, b) =>
      a.rule.store.localeCompare(b.rule.store) ||
      a.rule.sourceCategory.localeCompare(b.rule.sourceCategory),
  )
}

export interface RuleSuggestion {
  store: string
  category: string
  /** Purchases Moved to `category`. */
  moved: number
  /** Every purchase from the Store. */
  purchases: number
  /** Purchases from the Store that would change Category under the rule. */
  changes: number
}

/** A Store needs at least this many Moves to one Category to suggest a rule. */
export const MIN_MOVES = 2

/**
 * Rules the Moves suggest: each Store whose purchases were Moved to one
 * Category at least twice, more than to any other, and that no store-wide
 * rule already files there. Most Moves first.
 */
export function suggestRules(ix: LedgerIndex): Array<RuleSuggestion> {
  const byStore = new Map<
    string,
    { store: string; moves: Map<string, number>; purchases: number }
  >()
  for (const t of ix.ledger.txns) {
    const key = t.store.toLowerCase()
    const s = byStore.get(key) ?? {
      store: t.store,
      moves: new Map<string, number>(),
      purchases: 0,
    }
    s.purchases++
    if (t.category) s.moves.set(t.category, (s.moves.get(t.category) ?? 0) + 1)
    byStore.set(key, s)
  }
  const out: Array<RuleSuggestion> = []
  for (const s of byStore.values()) {
    const [first, second] = [...s.moves].sort((a, b) => b[1] - a[1])
    if (!first || first[1] < MIN_MOVES || first[1] === second?.[1]) continue
    const [category, moved] = first
    const has = ix.rules.get(ruleKey(ANY_SOURCE, s.store))?.category
    if (has === category) continue
    const changes = ix.ledger.txns.filter(
      (t) =>
        t.store.toLowerCase() === s.store.toLowerCase() &&
        !t.category &&
        categoryOf(ix, t) !== category,
    ).length
    out.push({
      store: s.store,
      category,
      moved,
      purchases: s.purchases,
      changes,
    })
  }
  return out.sort((a, b) => b.moved - a.moved || a.store.localeCompare(b.store))
}
