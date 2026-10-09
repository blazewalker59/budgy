/**
 * Changing Accounts and their Balances in D1, and adding one Account's
 * purchases (uploaded, or posted by an Agent). Shared by the app's server functions and the
 * Agents' tools. Server-only.
 */

import { and, between, eq, inArray, isNull, sql } from 'drizzle-orm'
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
  /** Starting purchases over the same dates, taken out for these. */
  replaced: number
  filed: Array<{
    date: string
    description: string
    amount: number
    category: string
    how: string
  }>
}

/** A Transaction from the whole-household export Budgy started from. */
const isStarting = sql<number>`${imports.account} is null`

/**
 * Add purchases for one Account: from its uploaded export, or read by an
 * Agent. With `replaceStarting`, the starting purchases over the same dates
 * make way for these (each handing its Move and note to its match).
 * Without `commit`, only say what would happen.
 */
export async function postTransactions(
  db: Database,
  input: {
    account: string
    rows: Array<PostedRow>
    commit: boolean
    importedBy: string
    replaceStarting?: boolean
    /** How the import is listed: an Agent's post or a Member's upload. */
    via?: 'posted' | 'uploaded'
  },
): Promise<PostSummary> {
  const account = await findAccount(db, input.account)
  const dates = input.rows.map((r) => r.date).sort()
  const [rules, cats, history, inRange] = await Promise.all([
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
            store: transactions.store,
            sourceCategory: transactions.sourceCategory,
            category: transactions.category,
            note: transactions.note,
            starting: isStarting,
          })
          .from(transactions)
          .leftJoin(imports, eq(imports.id, transactions.importId))
          .where(
            and(
              eq(transactions.account, account.name),
              between(transactions.date, dates[0], dates[dates.length - 1]),
            ),
          )
      : Promise.resolve([]),
  ])
  const replacing = input.replaceStarting
    ? inRange.filter((t) => t.starting)
    : []
  const existing = input.replaceStarting
    ? inRange.filter((t) => !t.starting)
    : inRange
  const prepared = await preparePosted({
    account: account.name,
    rows: input.rows,
    categories: cats.map((c) => c.name),
    history: storeHistory(history),
    existing,
    replacing,
    rules,
  })
  const summary: PostSummary = {
    account: account.name,
    added: prepared.fresh.length,
    replaced: replacing.length,
    alreadyHad: prepared.alreadyHad,
    notSpending: prepared.notSpending,
    carried: prepared.carried,
    duplicates: prepared.duplicates,
    filed: prepared.fresh.map((t) => ({
      date: t.date,
      description: t.description,
      amount: t.amount / 100,
      category: t.category ?? t.sourceCategory,
      how: t.filed,
    })),
  }
  if (!input.commit || (!prepared.fresh.length && !replacing.length))
    return summary

  const importId = `im_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const statements = []
  // Out first, so a new row with a starting one's id can take its place.
  for (let i = 0; i < replacing.length; i += IDS_PER_DELETE)
    statements.push(
      db.delete(transactions).where(
        inArray(
          transactions.id,
          replacing.slice(i, i + IDS_PER_DELETE).map((t) => t.id),
        ),
      ),
    )
  const categoryNames = new Set(prepared.fresh.map((t) => t.sourceCategory))
  for (const t of prepared.fresh) if (t.category) categoryNames.add(t.category)
  for (const name of categoryNames)
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
      fileName: `${input.via ?? 'posted'} to ${account.name}`,
      account: account.name,
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

/** D1 binds at most 100 values a statement. */
const IDS_PER_DELETE = 90

/**
 * Take out the starting purchases still here (one Account's, or all), for
 * when each Account's own uploads have taken over. Returns how many.
 */
export async function removeStarting(
  db: Database,
  account?: string,
): Promise<number> {
  const starting = db
    .select({ id: imports.id })
    .from(imports)
    .where(isNull(imports.account))
  const where = account
    ? and(
        inArray(transactions.importId, starting),
        eq(transactions.account, account),
      )
    : inArray(transactions.importId, starting)
  const gone = await db
    .delete(transactions)
    .where(where)
    .returning({ id: transactions.id })
  // A starting import with nothing left is history no one needs.
  await db
    .delete(imports)
    .where(
      and(
        isNull(imports.account),
        sql`not exists (select 1 from ${transactions} where ${transactions.importId} = ${imports.id})`,
      ),
    )
  return gone.length
}
