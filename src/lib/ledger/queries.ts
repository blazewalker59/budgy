/**
 * Reading and changing the Ledger in D1, shared by the app's server
 * functions and the Agents' MCP tools (docs/adr/0004). Server-only.
 */

import { eq } from 'drizzle-orm'
import type { Database } from '@/lib/db'
import type { Ledger } from '@/lib/model/types'
import {
  accounts,
  balances,
  budgetTargets,
  categories,
  paySchedules,
  plannedExpenses,
  storeRules,
  transactions,
} from '@/lib/db/schema'
import { newCategory } from '@/lib/model/defaults'

/** Every row of the Ledger, as the browser and the tools read it. */
export async function loadLedger(db: Database): Promise<Ledger> {
  const [cats, accts, txns, pay, rules, targets, plans, held] =
    await Promise.all([
      db.select().from(categories),
      db.select().from(accounts),
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
        })
        .from(transactions)
        .orderBy(transactions.date),
      db.select().from(paySchedules).orderBy(paySchedules.createdAt),
      db.select().from(storeRules),
      db.select().from(budgetTargets),
      db.select().from(plannedExpenses).orderBy(plannedExpenses.createdAt),
      db
        .select({
          account: balances.account,
          date: balances.date,
          amount: balances.amount,
        })
        .from(balances)
        .orderBy(balances.date),
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
    txns,
    pay: pay.map(({ id, name, amount, cadence, anchor, secondDay }) => ({
      id,
      name,
      amount,
      cadence,
      anchor,
      secondDay,
    })),
    rules,
    targets,
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
  await db.insert(categories).values(newCategory(name)).onConflictDoNothing()
}

/** Move one Transaction to a Category (null: back to its Store's). */
export async function moveTransaction(
  db: Database,
  id: string,
  category: string | null,
): Promise<void> {
  if (category) await ensureCategory(db, category)
  await db.update(transactions).set({ category }).where(eq(transactions.id, id))
}

export async function noteTransaction(
  db: Database,
  id: string,
  note: string | null,
): Promise<void> {
  await db
    .update(transactions)
    .set({ note: note?.trim() || null })
    .where(eq(transactions.id, id))
}
