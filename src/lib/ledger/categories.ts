/**
 * Renaming, hiding and deleting a Category. Every Ledger row names its
 * Category, so a rename rewrites them all in one batch; hiding keeps the
 * history and its totals; only a Category nothing refers to is deleted.
 * Server-only.
 */

import { and, eq, or, sql } from 'drizzle-orm'
import { DISMISSED_KEY, loadKeys } from './queries'
import { loadBankCategories } from './importer'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { Lens } from '@/lib/model/lens'
import { householdRow, inHousehold } from '@/lib/households/scope'
import {
  budgetTargets,
  categories,
  moneyIn,
  plannedExpenses,
  savedLenses,
  settings,
  storeRules,
  transactions,
} from '@/lib/db/schema'
import { TRANSFER } from '@/lib/model/ledger'
import { UNCATEGORIZED } from '@/lib/import/posted'
import {
  BANK_CATEGORIES_KEY,
  bankKey,
  storeBankCategories,
} from '@/lib/import/bankCategories'

/** Not Categories a Member can rename, hide or delete. */
const FIXED = new Set([TRANSFER, UNCATEGORIZED].map((n) => n.toLowerCase()))

async function findCategory(db: Database, name: string) {
  const found = await db
    .select()
    .from(categories)
    .where(inHousehold(db, categories, eq(categories.name, name)))
    .get()
  if (!found) throw new Error(`There’s no category called ${name}.`)
  return found
}

function changeable(name: string) {
  if (FIXED.has(name.toLowerCase()))
    throw new Error(`${name} can’t be changed.`)
}

export interface CategoryUses {
  purchases: number
  rules: number
  targets: number
  plans: number
  moneyIn: number
}

/** Every row that names this Category (Saved Lenses aside). */
export async function categoryUses(
  db: Database,
  name: string,
): Promise<CategoryUses> {
  const count = sql<number>`count(*)`
  const [purchases, rules, targets, plans, offsets] = await Promise.all([
    db
      .select({ n: count })
      .from(transactions)
      .where(
        inHousehold(
          db,
          transactions,
          or(
            eq(transactions.category, name),
            eq(transactions.sourceCategory, name),
          ),
        ),
      )
      .get(),
    db
      .select({ n: count })
      .from(storeRules)
      .where(
        inHousehold(
          db,
          storeRules,
          or(
            eq(storeRules.category, name),
            eq(storeRules.sourceCategory, name),
          ),
        ),
      )
      .get(),
    db
      .select({ n: count })
      .from(budgetTargets)
      .where(inHousehold(db, budgetTargets, eq(budgetTargets.category, name)))
      .get(),
    db
      .select({ n: count })
      .from(plannedExpenses)
      .where(
        inHousehold(db, plannedExpenses, eq(plannedExpenses.category, name)),
      )
      .get(),
    db
      .select({ n: count })
      .from(moneyIn)
      .where(inHousehold(db, moneyIn, eq(moneyIn.category, name)))
      .get(),
  ])
  return {
    purchases: purchases?.n ?? 0,
    rules: rules?.n ?? 0,
    targets: targets?.n ?? 0,
    plans: plans?.n ?? 0,
    moneyIn: offsets?.n ?? 0,
  }
}

const inUse = (uses: CategoryUses) => Object.values(uses).some((n) => n > 0)

/** Saved Lenses that pick out this Category, with it replaced (or gone). */
async function lensesNaming(db: Database, name: string, to: string | null) {
  const rows = await db
    .select({ id: savedLenses.id, lens: savedLenses.lens })
    .from(savedLenses)
    .where(inHousehold(db, savedLenses))
  return rows
    .filter((r) => (r.lens as Lens).categories?.includes(name))
    .map((r) => {
      const lens = r.lens as Lens
      const next = (lens.categories ?? []).flatMap((c) =>
        c !== name ? [c] : to ? [to] : [],
      )
      return {
        id: r.id,
        lens: {
          ...lens,
          categories: next.length ? [...new Set(next)] : undefined,
        },
      }
    })
}

/**
 * Give a Category a new name everywhere: its purchases (Moved there or
 * imported there), Store Rules, Targets, Planned Expenses, Money in offsets,
 * Saved Lenses and dismissed suggestions. Imports still naming the old one
 * file to the new one (a Bank category meaning).
 */
export async function renameCategory(
  db: Database,
  from: string,
  to: string,
): Promise<void> {
  to = to.trim()
  changeable(from)
  if (!to || to.length > 60)
    throw new Error('Name the category (up to 60 characters).')
  changeable(to)
  if (to === from) return
  await findCategory(db, from)
  const taken = await db
    .select({ name: categories.name })
    .from(categories)
    .where(
      inHousehold(
        db,
        categories,
        sql`lower(${categories.name}) = ${to.toLowerCase()}`,
      ),
    )
  if (taken.some((c) => c.name !== from) || inUse(await categoryUses(db, to)))
    throw new Error(`There’s already a category called ${to}.`)

  const [lenses, dismissed, meanings] = await Promise.all([
    lensesNaming(db, from, to),
    loadKeys(db, DISMISSED_KEY),
    loadBankCategories(db),
  ])
  const suffix = `|${from}`
  const nextDismissed = dismissed.map((k) =>
    k.endsWith(suffix) ? `${k.slice(0, -suffix.length)}|${to}` : k,
  )
  for (const [key, category] of meanings)
    if (category === from) meanings.set(key, to)
  meanings.set(bankKey(from), to)
  // A case-only rename means the same thing; no meaning needed for it.
  if (bankKey(from) === bankKey(to)) meanings.delete(bankKey(from))

  const setting = (key: string, value: string) =>
    db
      .insert(settings)
      .values(householdRow(db, { key, value }))
      .onConflictDoUpdate({
        target: [settings.householdId, settings.key],
        set: { value },
      })
  await db.batch([
    db
      .update(categories)
      .set({ name: to })
      .where(inHousehold(db, categories, eq(categories.name, from))),
    db
      .update(transactions)
      .set({ category: to })
      .where(inHousehold(db, transactions, eq(transactions.category, from))),
    db
      .update(transactions)
      .set({ sourceCategory: to })
      .where(
        inHousehold(db, transactions, eq(transactions.sourceCategory, from)),
      ),
    db
      .update(storeRules)
      .set({ category: to })
      .where(inHousehold(db, storeRules, eq(storeRules.category, from))),
    db
      .update(storeRules)
      .set({ sourceCategory: to })
      .where(inHousehold(db, storeRules, eq(storeRules.sourceCategory, from))),
    db
      .update(budgetTargets)
      .set({ category: to })
      .where(inHousehold(db, budgetTargets, eq(budgetTargets.category, from))),
    db
      .update(plannedExpenses)
      .set({ category: to })
      .where(
        inHousehold(db, plannedExpenses, eq(plannedExpenses.category, from)),
      ),
    db
      .update(moneyIn)
      .set({ category: to })
      .where(inHousehold(db, moneyIn, eq(moneyIn.category, from))),
    ...lenses.map((l) =>
      db
        .update(savedLenses)
        .set({ lens: l.lens })
        .where(inHousehold(db, savedLenses, eq(savedLenses.id, l.id))),
    ),
    setting(DISMISSED_KEY, JSON.stringify(nextDismissed)),
    setting(BANK_CATEGORIES_KEY, storeBankCategories(meanings)),
  ])
}

/** Hide a Category from pickers and the Budget, or bring it back. */
export async function hideCategory(
  db: Database,
  name: string,
  hidden: boolean,
): Promise<void> {
  changeable(name)
  await findCategory(db, name)
  await db
    .update(categories)
    .set({ hidden })
    .where(inHousehold(db, categories, eq(categories.name, name)))
}

/**
 * Delete a Category nothing refers to. One with purchases, rules, Targets,
 * Planned Expenses or offsets can only be hidden, so history never moves.
 */
export async function deleteCategory(db: Database, name: string) {
  changeable(name)
  await findCategory(db, name)
  if (inUse(await categoryUses(db, name)))
    throw new Error(`${name} is in use. Hide it instead.`)
  const lenses = await lensesNaming(db, name, null)
  const unused = and(
    sql`not exists (select 1 from ${transactions} where ${transactions.householdId} = ${db.householdId} and (${transactions.category} = ${name} or ${transactions.sourceCategory} = ${name}))`,
    sql`not exists (select 1 from ${budgetTargets} where ${budgetTargets.householdId} = ${db.householdId} and ${budgetTargets.category} = ${name})`,
    sql`not exists (select 1 from ${plannedExpenses} where ${plannedExpenses.householdId} = ${db.householdId} and ${plannedExpenses.category} = ${name})`,
    sql`not exists (select 1 from ${storeRules} where ${storeRules.householdId} = ${db.householdId} and (${storeRules.category} = ${name} or ${storeRules.sourceCategory} = ${name}))`,
    sql`not exists (select 1 from ${moneyIn} where ${moneyIn.householdId} = ${db.householdId} and ${moneyIn.category} = ${name})`,
  )
  // The checks are repeated in SQL: a purchase filed there meanwhile wins.
  const gone = await db
    .delete(categories)
    .where(inHousehold(db, categories, and(eq(categories.name, name), unused)))
    .returning({ name: categories.name })
  if (!gone.length) throw new Error(`${name} is in use. Hide it instead.`)
  for (const l of lenses)
    await db
      .update(savedLenses)
      .set({ lens: l.lens })
      .where(inHousehold(db, savedLenses, eq(savedLenses.id, l.id)))
}
