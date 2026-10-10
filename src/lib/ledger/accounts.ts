/**
 * Changing Accounts and their Balances in D1, and adding one Account's
 * purchases (uploaded, or posted by an Agent). Shared by the app's server functions and the
 * Agents' tools. Server-only.
 */

import { and, between, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  STATEMENTS_PER_BATCH,
  loadImportRules,
  rowsPerInsert,
} from './importer'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { Account, Balance } from '@/lib/model/types'
import type { PostedRow, Prepared } from '@/lib/import/posted'
import type { UpdateSource } from '@/lib/updates/receipts'
import { householdOwners } from '@/lib/households/locale'
import { householdRow, inHousehold } from '@/lib/households/scope'
import {
  accountInputs,
  accountUpdateLocks,
  accountUpdates,
  accounts,
  balances,
  bankAccounts,
  categories,
  imports,
  transactions,
  uploadTokens,
} from '@/lib/db/schema'
import { newCategory } from '@/lib/model/defaults'
import { addDays } from '@/lib/model/dates'
import {
  postedRowInput,
  preparePosted,
  storeHistory,
} from '@/lib/import/posted'
import { prepareIdentified } from '@/lib/updates/reconcile'
import {
  acquireUpdate,
  finishReceipt,
  releaseUpdate,
  renewUpdate,
  startReceipt,
} from '@/lib/updates/receipts'

/** An Account by name, any case; the error lists the real names. */
export async function findAccount(
  db: Database,
  name: string,
): Promise<Account> {
  const all = await db.select().from(accounts).where(inHousehold(db, accounts))
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
      .where(
        inHousehold(
          db,
          accounts,
          sql`lower(${accounts.name}) = ${a.name.toLowerCase()}`,
        ),
      )
    if (taken.length)
      throw new Error(`There's already an account named ${a.name}.`)
    await db
      .insert(accounts)
      .values(householdRow(db, { ...a, sourceName: a.name }))
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
    .where(inHousehold(db, accounts, eq(accounts.name, a.name)))
}

/** Remove an Account and its Balances; only one without purchases. */
export async function deleteAccount(db: Database, name: string): Promise<void> {
  const lease = await acquireUpdate(db, name)
  try {
    const used = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(inHousehold(db, transactions, eq(transactions.account, name)))
      .limit(1)
    if (used.length) throw new Error(`${name} has purchases. Close it instead.`)
    await db.batch([
      db
        .delete(balances)
        .where(inHousehold(db, balances, eq(balances.account, name))),
      db
        .delete(accounts)
        .where(inHousehold(db, accounts, eq(accounts.name, name))),
      db
        .delete(accountUpdates)
        .where(
          inHousehold(db, accountUpdates, eq(accountUpdates.account, name)),
        ),
      db
        .delete(accountUpdateLocks)
        .where(
          inHousehold(
            db,
            accountUpdateLocks,
            eq(accountUpdateLocks.account, name),
          ),
        ),
      db
        .delete(accountInputs)
        .where(inHousehold(db, accountInputs, eq(accountInputs.account, name))),
      db
        .delete(uploadTokens)
        .where(inHousehold(db, uploadTokens, eq(uploadTokens.account, name))),
      db
        .update(bankAccounts)
        .set({ account: null })
        .where(inHousehold(db, bankAccounts, eq(bankAccounts.account, name))),
    ])
  } finally {
    await releaseUpdate(db, name, lease)
  }
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
  const perInsert = rowsPerInsert(balances)
  for (const account of new Set(rows.map((b) => b.account)))
    await findAccount(db, account)
  for (let i = 0; i < rows.length; i += perInsert)
    statements.push(
      db
        .insert(balances)
        .values(
          rows
            .slice(i, i + perInsert)
            .map((b) => householdRow(db, { ...b, recordedBy })),
        )
        .onConflictDoUpdate({
          target: [balances.householdId, balances.account, balances.date],
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
  await db
    .delete(balances)
    .where(inHousehold(db, balances, eq(balances.account, account)))
}

export async function deleteBalance(
  db: Database,
  account: string,
  date: string,
): Promise<void> {
  await db
    .delete(balances)
    .where(
      inHousehold(
        db,
        balances,
        and(eq(balances.account, account), eq(balances.date, date)),
      ),
    )
}

export interface PostSummary extends Omit<Prepared, 'fresh'> {
  account: string
  added: number
  /** Starting purchases over the same dates, taken out for these. */
  replaced: number
  updated: number
  linked: number
  review: Array<{
    date: string
    description: string
    amount: number
    reason: string
  }>
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
export interface PostInput {
  account: string
  rows: Array<PostedRow>
  commit: boolean
  importedBy: string
  replaceStarting?: boolean
  /** How the import is listed: an Agent's post or a Member's upload. */
  via?: UpdateSource
  /** Trusted connector namespace, stable across overlapping windows. */
  sourceNamespace?: string
  coverage?: { from: string; to: string }
  /** Payments/transfers excluded by the normalizer, before purchase filing. */
  excluded?: number
}

/** All writers use one Account lease and one receipt format. Preview is read-only. */
export async function postTransactions(
  db: Database,
  input: PostInput,
): Promise<PostSummary> {
  if (input.rows.length > 20_000)
    throw new Error('An update can include at most 20,000 purchases.')
  input = { ...input, rows: input.rows.map((row) => postedRowInput.parse(row)) }
  if (input.rows.some((row) => row.sourceId) && !input.sourceNamespace)
    throw new Error('Source IDs require a connector namespace')
  if (input.sourceNamespace && input.replaceStarting)
    throw new Error(
      'Identified sources reconcile individually; they cannot replace a date range',
    )
  const account = await findAccount(db, input.account)
  if (account.closed) throw new Error('Reopen this account to update it.')
  if (!input.commit)
    return postTransactionsUnlocked(db, { ...input, account: account.name })
  const lease = await acquireUpdate(db, account.name)
  const id = crypto.randomUUID()
  let started = false
  try {
    await startReceipt(db, {
      id,
      account: account.name,
      source: input.via ?? 'posted',
      updatedBy: input.importedBy,
      dates: input.coverage
        ? [input.coverage.from, input.coverage.to]
        : input.rows.map((r) => r.date),
    })
    started = true
    const summary = await postTransactionsUnlocked(
      db,
      { ...input, account: account.name },
      lease,
    )
    await renewUpdate(db, account.name, lease)
    await finishReceipt(db, id, summary)
    return summary
  } catch (error) {
    if (started) await finishReceipt(db, id, null)
    throw error
  } finally {
    await releaseUpdate(db, account.name, lease)
  }
}

async function postTransactionsUnlocked(
  db: Database,
  input: PostInput,
  lease?: string,
): Promise<PostSummary> {
  const account = await findAccount(db, input.account)
  const dates = input.rows.map((r) => r.date).sort()
  const [rules, owners, cats, history, inRange] = await Promise.all([
    loadImportRules(db),
    householdOwners(db),
    db
      .select({ name: categories.name })
      .from(categories)
      .where(inHousehold(db, categories)),
    db
      .select({
        store: transactions.store,
        sourceCategory: transactions.sourceCategory,
      })
      .from(transactions)
      .where(inHousehold(db, transactions)),
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
            sourceKey: transactions.sourceKey,
          })
          .from(transactions)
          .leftJoin(
            imports,
            and(
              eq(imports.id, transactions.importId),
              eq(imports.householdId, transactions.householdId),
            ),
          )
          .where(
            and(
              inHousehold(db, transactions),
              eq(transactions.account, account.name),
              between(
                transactions.date,
                input.sourceNamespace ? addDays(dates[0], -3) : dates[0],
                input.sourceNamespace
                  ? addDays(dates[dates.length - 1], 3)
                  : dates[dates.length - 1],
              ),
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
  const identifiedExisting = input.sourceNamespace
    ? await db
        .select({
          id: transactions.id,
          date: transactions.date,
          amount: transactions.amount,
          description: transactions.description,
          sourceKey: transactions.sourceKey,
        })
        .from(transactions)
        .where(
          inHousehold(
            db,
            transactions,
            and(
              eq(transactions.account, account.name),
              isNotNull(transactions.sourceKey),
            ),
          ),
        )
    : []
  const identified = input.sourceNamespace
    ? await prepareIdentified({
        account: account.name,
        namespace: input.sourceNamespace,
        rows: input.rows,
        existing: [
          ...new Map(
            [...inRange, ...identifiedExisting].map((t) => [t.id, t]),
          ).values(),
        ],
        categories: cats.map((c) => c.name),
        history: storeHistory(history),
        rules,
        owners,
      })
    : null
  const prepared =
    identified?.prepared ??
    (await preparePosted({
      account: account.name,
      rows: input.rows,
      categories: cats.map((c) => c.name),
      history: storeHistory(history),
      existing,
      replacing,
      rules,
      owners,
    }))
  const summary: PostSummary = {
    account: account.name,
    added: prepared.fresh.length,
    replaced: replacing.length,
    updated: identified?.changes.length ?? 0,
    linked: identified?.links.length ?? 0,
    review: identified?.conflicts ?? [],
    alreadyHad: prepared.alreadyHad,
    notSpending: prepared.notSpending + (input.excluded ?? 0),
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
  if (
    !input.commit ||
    (!prepared.fresh.length &&
      !replacing.length &&
      !summary.updated &&
      !summary.linked)
  )
    return summary

  const importId = `im_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const statements = []
  // Write the import header first: a failed later chunk must not leave
  // saved purchases looking like unowned starting data on retry.
  statements.push(
    db.insert(imports).values({
      householdId: db.householdId,
      id: importId,
      fileName: `${input.via ?? 'posted'} to ${account.name}`,
      account: account.name,
      importedBy: input.importedBy,
      added: prepared.fresh.length,
      skipped: prepared.alreadyHad + prepared.duplicates.length,
    }),
  )
  for (const link of identified?.links ?? [])
    statements.push(
      db
        .update(transactions)
        .set({ sourceKey: link.sourceKey, importId })
        .where(
          inHousehold(
            db,
            transactions,
            and(
              eq(transactions.id, link.id),
              eq(transactions.account, account.name),
              isNull(transactions.sourceKey),
            ),
          ),
        ),
    )
  for (const change of identified?.changes ?? []) {
    const { id, sourceKey, ...data } = change
    // Never write category, sourceCategory or note: Member filing always wins.
    statements.push(
      db
        .update(transactions)
        .set({ ...data, month: data.date.slice(0, 7) })
        .where(
          inHousehold(
            db,
            transactions,
            and(
              eq(transactions.id, id),
              eq(transactions.account, account.name),
              eq(transactions.sourceKey, sourceKey),
            ),
          ),
        ),
    )
  }
  // Out first, so a new row with a starting one's id can take its place.
  for (let i = 0; i < replacing.length; i += IDS_PER_DELETE)
    statements.push(
      db.delete(transactions).where(
        inHousehold(
          db,
          transactions,
          inArray(
            transactions.id,
            replacing.slice(i, i + IDS_PER_DELETE).map((t) => t.id),
          ),
        ),
      ),
    )
  const categoryNames = new Set(prepared.fresh.map((t) => t.sourceCategory))
  for (const t of prepared.fresh) if (t.category) categoryNames.add(t.category)
  for (const name of categoryNames)
    statements.push(
      db
        .insert(categories)
        .values(householdRow(db, newCategory(name)))
        .onConflictDoNothing(),
    )
  const perInsert = rowsPerInsert(transactions)
  for (let i = 0; i < prepared.fresh.length; i += perInsert)
    statements.push(
      db
        .insert(transactions)
        .values(
          prepared.fresh
            .slice(i, i + perInsert)
            .map(({ accountSource: _s, filed: _f, ...t }) => ({
              ...t,
              householdId: db.householdId,
              importId,
              sourceKey: identified?.keys.get(t.id) ?? null,
            })),
        )
        .onConflictDoNothing(),
    )
  if (input.replaceStarting && statements.length > STATEMENTS_PER_BATCH)
    throw new Error(
      'This export is too large to replace starting purchases at once. Split it into smaller date ranges.',
    )
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    if (lease) await renewUpdate(db, account.name, lease)
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
    .where(inHousehold(db, imports, isNull(imports.account)))
  const where = account
    ? and(
        inArray(transactions.importId, starting),
        eq(transactions.account, account),
      )
    : inArray(transactions.importId, starting)
  const gone = await db
    .delete(transactions)
    .where(inHousehold(db, transactions, where))
    .returning({ id: transactions.id })
  // A starting import with nothing left is history no one needs.
  await db
    .delete(imports)
    .where(
      and(
        inHousehold(db, imports),
        isNull(imports.account),
        sql`not exists (select 1 from ${transactions} where ${transactions.importId} = ${imports.id} and ${transactions.householdId} = ${imports.householdId})`,
      ),
    )
  return gone.length
}
