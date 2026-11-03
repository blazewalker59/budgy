/**
 * Bank categories in D1: which ones purchases came with, and filing one
 * under a Category. Saying what one means files its purchases still
 * Uncategorized (and every later import) as that Category; Moves and Store
 * Rules still win, as they do over any import Category. Server-only.
 */

import { and, inArray, isNotNull, sql } from 'drizzle-orm'
import { ensureCategory } from './queries'
import { loadBankCategories } from './importer'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { categories, settings, transactions } from '@/lib/db/schema'
import { UNCATEGORIZED } from '@/lib/import/posted'
import {
  BANK_CATEGORIES_KEY,
  bankKey,
  storeBankCategories,
} from '@/lib/import/bankCategories'
import { TRANSFER } from '@/lib/model/ledger'
import { UserError } from '@/lib/errors'

export interface BankCategoryUse {
  /** As the bank names it (the most common spelling). */
  name: string
  purchases: number
  /** Of them, still Uncategorized. */
  unsorted: number
  /** Cents spent, all of them. */
  spent: number
  /** The Category it files to, if a Member said. */
  means: string | null
}

/**
 * The Bank categories purchases came with that aren't already one of the
 * Household's Categories by name: most still to sort first.
 */
export async function listBankCategories(
  db: Database,
): Promise<Array<BankCategoryUse>> {
  const [rows, cats, meanings] = await Promise.all([
    db
      .select({
        name: transactions.bankCategory,
        n: sql<number>`count(*)`,
        unsorted: sql<number>`sum(case when ${transactions.sourceCategory} = ${UNCATEGORIZED} and ${transactions.category} is null then 1 else 0 end)`,
        spent: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(
        inHousehold(db, transactions, isNotNull(transactions.bankCategory)),
      )
      .groupBy(transactions.bankCategory),
    db
      .select({ name: categories.name })
      .from(categories)
      .where(inHousehold(db, categories)),
    loadBankCategories(db),
  ])
  const own = new Set(cats.map((c) => bankKey(c.name)))
  const out = new Map<string, BankCategoryUse & { top: number }>()
  for (const r of rows) {
    if (!r.name) continue
    const key = bankKey(r.name)
    if (own.has(key)) continue
    const had = out.get(key)
    const use = had ?? {
      name: r.name,
      top: 0,
      purchases: 0,
      unsorted: 0,
      spent: 0,
      means: meanings.get(key) ?? null,
    }
    if (r.n > use.top) {
      use.name = r.name
      use.top = r.n
    }
    use.purchases += r.n
    use.unsorted += r.unsorted
    use.spent += r.spent
    out.set(key, use)
  }
  return [...out.values()]
    .map(({ top: _t, ...use }) => use)
    .sort(
      (a, b) =>
        b.unsorted - a.unsorted ||
        b.purchases - a.purchases ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 200)
}

/**
 * Say what a Bank category means (or null: nothing). Its purchases still
 * Uncategorized, or filed by what it meant before, move with it.
 */
export async function fileBankCategory(
  db: Database,
  name: string,
  category: string | null,
): Promise<{ moved: number }> {
  const key = bankKey(name)
  if (!key) throw new UserError('Name the bank’s category.')
  if (category !== null) {
    category = category.trim()
    if (!category || category === UNCATEGORIZED)
      throw new UserError('Choose a category.')
    if (category !== TRANSFER) await ensureCategory(db, category)
  }
  const meanings = await loadBankCategories(db)
  const before = meanings.get(key) ?? null
  if (category) meanings.set(key, category)
  else meanings.delete(key)
  const value = storeBankCategories(meanings)
  const from = [UNCATEGORIZED, ...(before ? [before] : [])]
  const [, moved] = await db.batch([
    db
      .insert(settings)
      .values(householdRow(db, { key: BANK_CATEGORIES_KEY, value }))
      .onConflictDoUpdate({
        target: [settings.householdId, settings.key],
        set: { value },
      }),
    db
      .update(transactions)
      .set({ sourceCategory: category ?? UNCATEGORIZED })
      .where(
        inHousehold(
          db,
          transactions,
          and(
            sql`lower(${transactions.bankCategory}) = ${key}`,
            inArray(transactions.sourceCategory, from),
          ),
        ),
      )
      .returning({ id: transactions.id }),
  ])
  if (!category) await ensureCategory(db, UNCATEGORIZED)
  return { moved: moved.length }
}
