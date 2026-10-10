/**
 * Reading and changing the Ledger in D1, shared by the app's server
 * functions and the Agents' MCP tools (docs/adr/0004). Server-only.
 */

import { and, eq, sql } from 'drizzle-orm'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { Ledger } from '@/lib/model/types'
import { householdRow, inHousehold } from '@/lib/households/scope'
import {
  accounts,
  balances,
  budgetTargets,
  categories,
  imports,
  paySchedules,
  plannedExpenses,
  savedLenses,
  storeRules,
  transactions,
} from '@/lib/db/schema'
import { newCategory } from '@/lib/model/defaults'
import { readLens } from '@/lib/model/lens'

/** Every row of the Ledger, as the browser and the tools read it. */
export async function loadLedger(db: Database): Promise<Ledger> {
  const [cats, accts, txns, pay, rules, targets, plans, held, lenses] =
    await Promise.all([
      db.select().from(categories).where(inHousehold(db, categories)),
      db.select().from(accounts).where(inHousehold(db, accounts)),
      db
        .select({
          id: transactions.id,
          date: transactions.date,
          month: transactions.month,
          account: transactions.account,
          description: transactions.description,
          store: transactions.store,
          sourceCategory: transactions.sourceCategory,
          amount: transactions.amount,
          category: transactions.category,
          note: transactions.note,
          starting: sql<number>`${imports.account} is null`,
        })
        .from(transactions)
        .leftJoin(
          imports,
          and(
            eq(imports.id, transactions.importId),
            eq(imports.householdId, transactions.householdId),
          ),
        )
        .where(inHousehold(db, transactions))
        .orderBy(transactions.date),
      db
        .select()
        .from(paySchedules)
        .where(inHousehold(db, paySchedules))
        .orderBy(paySchedules.createdAt),
      db.select().from(storeRules).where(inHousehold(db, storeRules)),
      db.select().from(budgetTargets).where(inHousehold(db, budgetTargets)),
      db
        .select()
        .from(plannedExpenses)
        .where(inHousehold(db, plannedExpenses))
        .orderBy(plannedExpenses.createdAt),
      db
        .select({
          account: balances.account,
          date: balances.date,
          amount: balances.amount,
        })
        .from(balances)
        .where(inHousehold(db, balances))
        .orderBy(balances.date),
      db
        .select({
          id: savedLenses.id,
          name: savedLenses.name,
          lens: savedLenses.lens,
        })
        .from(savedLenses)
        .where(inHousehold(db, savedLenses))
        .orderBy(savedLenses.name),
    ])
  return {
    categories: cats.map(({ name, tag, group }) => ({ name, tag, group })),
    accounts: accts.map(
      ({ name, sourceName, owner, kind, institution, closed, securedBy }) => ({
        name,
        sourceName,
        owner,
        kind,
        institution,
        closed,
        securedBy,
      }),
    ),
    balances: held,
    lenses: lenses.map((l) => ({
      ...l,
      lens: readLens(l.lens as Record<string, unknown>),
    })),
    txns: txns.map(({ starting, ...t }) =>
      starting ? { ...t, starting: true } : t,
    ),
    pay: pay.map(({ id, name, amount, cadence, anchor, secondDay }) => ({
      id,
      name,
      amount,
      cadence,
      anchor,
      secondDay,
    })),
    rules: rules.map(({ householdId: _h, ...rule }) => rule),
    targets: targets.map(({ householdId: _h, ...target }) => target),
    plans: plans.map(
      ({ id, name, category, store, amount, cadence, anchor, active }) => ({
        id,
        name,
        category,
        store,
        amount,
        cadence,
        anchor,
        active,
      }),
    ),
  }
}

/** A Category named in an edit exists from then on. */
export async function ensureCategory(
  db: Database,
  name: string,
): Promise<void> {
  await db
    .insert(categories)
    .values(householdRow(db, newCategory(name)))
    .onConflictDoNothing()
}

/** Move one Transaction to a Category (null: back to its Store's). */
export async function moveTransaction(
  db: Database,
  id: string,
  category: string | null,
): Promise<void> {
  if (category) await ensureCategory(db, category)
  await db
    .update(transactions)
    .set({ category })
    .where(inHousehold(db, transactions, eq(transactions.id, id)))
}

export async function noteTransaction(
  db: Database,
  id: string,
  note: string | null,
): Promise<void> {
  await db
    .update(transactions)
    .set({ note: note?.trim() || null })
    .where(inHousehold(db, transactions, eq(transactions.id, id)))
}
