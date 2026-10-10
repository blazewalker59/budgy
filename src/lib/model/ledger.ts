/**
 * Resolving a Transaction against the Ledger's labels: its Category after
 * Store Rules and Moves, its Tag, its Owner, and a Category's Target for a
 * month.
 */

import type {
  Category,
  Ledger,
  Owner,
  StoreRule,
  Tag,
  Target,
  Txn,
} from './types'

/**
 * A Store Rule for this `sourceCategory` covers the Store whatever Category
 * its purchases came in with: the rule a Member makes from a Move, so
 * purchases uploaded later are filed the same way.
 */
export const ANY_SOURCE = '*'

/**
 * Not a Category: where a Transaction goes when it's money moving between
 * the Household's own Accounts (a payment into a 529). Moved or filed there
 * by a Store Rule like any Category, it leaves spending and the Budget.
 */
export const TRANSFER = 'Transfer'

/** Store names match in any case ("KROGER" is "Kroger"). */
export function ruleKey(sourceCategory: string, store: string): string {
  return `${sourceCategory}\u0000${store.toLowerCase()}`
}

export interface LedgerIndex {
  ledger: Ledger
  categories: Map<string, Category>
  rules: Map<string, StoreRule>
  owners: Map<string, Owner>
  /** Per Category, Targets newest first. */
  targets: Map<string, Array<Target>>
  /** Transactions filed as a Transfer, kept out of `ledger.txns`. */
  transfers: Array<Txn>
}

export function indexLedger(ledger: Ledger): LedgerIndex {
  const targets = new Map<string, Array<Target>>()
  for (const t of ledger.targets) {
    const list = targets.get(t.category) ?? []
    list.push(t)
    targets.set(t.category, list)
  }
  for (const list of targets.values())
    list.sort((a, b) => b.startsMonth.localeCompare(a.startsMonth))
  const ix: LedgerIndex = {
    ledger,
    categories: new Map(
      ledger.categories
        .filter((c) => c.name !== TRANSFER)
        .map((c) => [c.name, c]),
    ),
    rules: new Map(
      ledger.rules.map((r) => [ruleKey(r.sourceCategory, r.store), r]),
    ),
    owners: new Map(ledger.accounts.map((a) => [a.name, a.owner])),
    targets,
    transfers: [],
  }
  // Every total reads `ledger.txns`, so Transfers are set aside here once.
  const spending: Array<Txn> = []
  for (const t of ledger.txns)
    (categoryOf(ix, t) === TRANSFER ? ix.transfers : spending).push(t)
  if (ix.transfers.length) ix.ledger = { ...ledger, txns: spending }
  return ix
}

/** Every Transaction, Transfers too: for filing, not for totals. */
export function everyTxn(ix: LedgerIndex): Array<Txn> {
  return ix.transfers.length
    ? [...ix.ledger.txns, ...ix.transfers]
    : ix.ledger.txns
}

/** The Store Rule for a purchase: one for its own import Category first. */
export function ruleFor(
  ix: LedgerIndex,
  t: Pick<Txn, 'sourceCategory' | 'store'>,
): StoreRule | undefined {
  return (
    ix.rules.get(ruleKey(t.sourceCategory, t.store)) ??
    ix.rules.get(ruleKey(ANY_SOURCE, t.store))
  )
}

/** Where the Store's Transactions go: the Store Rule, else the import's. */
export function storeCategory(ix: LedgerIndex, t: Txn): string {
  return ruleFor(ix, t)?.category ?? t.sourceCategory
}

/** The Category a Transaction counts toward. A Move wins over a Store Rule. */
export function categoryOf(ix: LedgerIndex, t: Txn): string {
  return t.category ?? storeCategory(ix, t)
}

export function categoryTag(ix: LedgerIndex, name: string): Tag {
  return ix.categories.get(name)?.tag ?? 'nice'
}

export function isHousing(ix: LedgerIndex, name: string): boolean {
  return ix.categories.get(name)?.group === 'housing'
}

/** A Store Rule's Tag, unless the Transaction was Moved on its own. */
export function tagOf(ix: LedgerIndex, t: Txn): Tag {
  if (!t.category) {
    const tag = ruleFor(ix, t)?.tag
    if (tag) return tag
  }
  return categoryTag(ix, categoryOf(ix, t))
}

export function ownerOf(ix: LedgerIndex, t: Txn): Owner {
  return ix.owners.get(t.account) ?? 'Joint'
}

/** The Target in force for `month`: the newest one starting on or before it. */
export function targetFor(
  ix: LedgerIndex,
  category: string,
  month: string,
): number | null {
  const found = ix.targets.get(category)?.find((t) => t.startsMonth <= month)
  return found ? found.amount : null
}

/** Every Category name in use, known or only referenced. */
export function allCategoryNames(ix: LedgerIndex): Array<string> {
  const names = new Set(ix.categories.keys())
  for (const t of ix.ledger.txns) names.add(categoryOf(ix, t))
  return [...names].sort((a, b) => a.localeCompare(b))
}
