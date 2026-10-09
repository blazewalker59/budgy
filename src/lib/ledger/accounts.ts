/**
 * Changing Accounts and their Balances in D1, and adding purchases an Agent
 * posts for one Account. Shared by the app's server functions and the
 * Agents' tools. Server-only.
 */

import { and, between, eq, sql } from 'drizzle-orm'
import {
  ROWS_PER_INSERT,
  STATEMENTS_PER_BATCH,
  loadImportRules,
} from './importer'
import type { Database } from '@/lib/db'
import type { Account, Balance } from '@/lib/model/types'
import type { PostedRow, Prepared } from '@/lib/import/posted'
import {
  accounts,
  balances,
  categories,
  imports,
  transactions,
} from '@/lib/db/schema'
import { newCategory } from '@/lib/model/defaults'
import { preparePosted, storeHistory } from '@/lib/import/posted'

/** An Account by name, any case; the error lists the real names. */
export async function findAccount(
  db: Database,
  name: string,
): Promise<Account> {
  const all = await db.select().from(accounts)
  const found = all.find(
    (a) => a.name.toLowerCase() === name.trim().toLowerCase(),
  )
  if (!found)
    throw new Error(
      `No account named "${name}". Accounts: ${all.map((a) => a.name).join(', ')}`,
    )
  return found
}

/** Add an Account, or change one's owner, kind, institution or closing. */
export async function saveAccount(
  db: Database,
  a: Omit<Account, 'sourceName'>,
  isNew: boolean,
): Promise<void> {
  if (isNew) {
    const taken = await db
      .select({ name: accounts.name })
      .from(accounts)
      .where(sql`lower(${accounts.name}) = ${a.name.toLowerCase()}`)
    if (taken.length)
      throw new Error(`There's already an account named ${a.name}.`)
    await db.insert(accounts).values({ ...a, sourceName: a.name })
    return
  }
  await db
    .update(accounts)
    .set({
      owner: a.owner,
      kind: a.kind,
      institution: a.institution,
      closed: a.closed,
      securedBy: a.kind === 'loan' ? a.securedBy : null,
    })
    .where(eq(accounts.name, a.name))
}

/** Remove an Account and its Balances; only one without purchases. */
export async function deleteAccount(db: Database, name: string): Promise<void> {
  const used = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.account, name))
    .limit(1)
  if (used.length) throw new Error(`${name} has purchases; close it instead.`)
  await db.batch([
    db.delete(balances).where(eq(balances.account, name)),
    db.delete(accounts).where(eq(accounts.name, name)),
  ])
}

/**
 * Record Balances, one or a whole history; a second one for the same
 * Account and day replaces it.
 */
export async function recordBalances(
  db: Database,
  rows: Array<Balance>,
  recordedBy: string,
): Promise<void> {
  const statements = []
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT)
    statements.push(
      db
        .insert(balances)
        .values(
          rows.slice(i, i + ROWS_PER_INSERT).map((b) => ({ ...b, recordedBy })),
        )
        .onConflictDoUpdate({
          target: [balances.account, balances.date],
          set: {
            amount: sql`excluded.amount`,
            recordedBy: sql`excluded.recorded_by`,
          },
        }),
    )
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    const chunk = statements.slice(i, i + STATEMENTS_PER_BATCH)
    await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk])
  }
}

/** Forget every Balance of an Account (a wrong history, before a new one). */
export async function clearBalances(
  db: Database,
  account: string,
): Promise<void> {
  await db.delete(balances).where(eq(balances.account, account))
}

export async function deleteBalance(
  db: Database,
  account: string,
  date: string,
): Promise<void> {
  await db
    .delete(balances)
    .where(and(eq(balances.account, account), eq(balances.date, date)))
}

export interface PostSummary extends Omit<Prepared, 'fresh'> {
  account: string
  added: number
  filed: Array<{
    date: string
    description: string
    amount: number
    category: string
    how: string
  }>
}

/**
 * Add the purchases an Agent read for one Account. Without `commit`, only
 * say what would happen.
 */
export async function postTransactions(
  db: Database,
  input: {
    account: string
    rows: Array<PostedRow>
    commit: boolean
    importedBy: string
  },
): Promise<PostSummary> {
  const account = await findAccount(db, input.account)
  const dates = input.rows.map((r) => r.date).sort()
  const [rules, cats, history, existing] = await Promise.all([
    loadImportRules(db),
    db.select({ name: categories.name }).from(categories),
    db
      .select({
        store: transactions.store,
        sourceCategory: transactions.sourceCategory,
      })
      .from(transactions),
    dates.length
      ? db
          .select({
            id: transactions.id,
            date: transactions.date,
            amount: transactions.amount,
            description: transactions.description,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.account, account.name),
              between(transactions.date, dates[0], dates[dates.length - 1]),
            ),
          )
      : Promise.resolve([]),
  ])
  const prepared = await preparePosted({
    account: account.name,
    rows: input.rows,
    categories: cats.map((c) => c.name),
    history: storeHistory(history),
    existing,
    rules,
  })
  const summary: PostSummary = {
    account: account.name,
    added: prepared.fresh.length,
    alreadyHad: prepared.alreadyHad,
    duplicates: prepared.duplicates,
    filed: prepared.fresh.map((t) => ({
      date: t.date,
      description: t.description,
      amount: t.amount / 100,
      category: t.sourceCategory,
      how: t.filed,
    })),
  }
  if (!input.commit || !prepared.fresh.length) return summary

  const importId = `im_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const statements = []
  for (const name of new Set(prepared.fresh.map((t) => t.sourceCategory)))
    statements.push(
      db.insert(categories).values(newCategory(name)).onConflictDoNothing(),
    )
  for (let i = 0; i < prepared.fresh.length; i += ROWS_PER_INSERT)
    statements.push(
      db
        .insert(transactions)
        .values(
          prepared.fresh
            .slice(i, i + ROWS_PER_INSERT)
            .map(({ accountSource: _s, filed: _f, ...t }) => ({
              ...t,
              importId,
            })),
        )
        .onConflictDoNothing(),
    )
  statements.push(
    db.insert(imports).values({
      id: importId,
      fileName: `posted to ${account.name}`,
      importedBy: input.importedBy,
      added: prepared.fresh.length,
      skipped: prepared.alreadyHad + prepared.duplicates.length,
    }),
  )
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    const chunk = statements.slice(i, i + STATEMENTS_PER_BATCH)
    await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk])
  }
  return summary
}
