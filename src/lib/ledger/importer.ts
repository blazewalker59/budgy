/**
 * Importing an export into the Ledger: what's new, and adding it. Shared by
 * the Import screen and the Agents' import tool. Server-only.
 */

import { between, eq, inArray } from 'drizzle-orm'
import type { Database } from '@/lib/db'
import type { ImportRules } from '@/lib/import/rules'
import {
  accounts,
  categories,
  imports,
  settings,
  transactions,
} from '@/lib/db/schema'
import { DEFAULT_CATEGORIES, newCategory } from '@/lib/model/defaults'
import { ImportError, parseExport } from '@/lib/import/rows'
import { parseImportRules } from '@/lib/import/rules'
import { defaultOwner } from '@/lib/import/stores'

export interface ImportSummary {
  fileName: string
  /** Spending rows in the file. */
  rows: number
  added: number
  alreadyHad: number
  skipped: { notSpending: number; otherTypes: number; invalid: number }
  from: string | null
  to: string | null
  newAccounts: Array<string>
  /** New Transactions per Account, for checking coverage. */
  byAccount: Array<{
    account: string
    added: number
    first: string
    last: string
  }>
}

/** Each statement may bind at most 100 values in D1. */
const ROWS_PER_INSERT = 10
const STATEMENTS_PER_BATCH = 40

export const RULES_KEY = 'import_rules'

export async function loadImportRules(db: Database): Promise<ImportRules> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, RULES_KEY))
    .get()
  return parseImportRules(row?.value)
}

/**
 * Read an export and, with `commit`, add the Transactions the Ledger
 * doesn't have yet. Without it, only say what would happen.
 */
export async function runImport(
  db: Database,
  input: {
    fileName: string
    text: string
    commit: boolean
    importedBy: string
  },
): Promise<ImportSummary> {
  let parsed
  try {
    parsed = await parseExport(input.text, await loadImportRules(db))
  } catch (error) {
    if (error instanceof ImportError) throw new Error(error.message)
    throw error
  }
  const { txns, skipped } = parsed
  const from = txns[0]?.month ?? null
  const to = txns[txns.length - 1]?.month ?? null

  const have = new Set<string>()
  if (from && to) {
    const rows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(between(transactions.month, from, to))
    for (const r of rows) have.add(r.id)
  }
  const fresh = txns.filter((t) => !have.has(t.id))

  const sourceAccounts = new Map(txns.map((t) => [t.account, t.accountSource]))
  const known = new Set(
    sourceAccounts.size
      ? (
          await db
            .select({ name: accounts.name })
            .from(accounts)
            .where(inArray(accounts.name, [...sourceAccounts.keys()]))
        ).map((a) => a.name)
      : [],
  )
  const newAccounts = [...sourceAccounts.keys()].filter((a) => !known.has(a))

  const byAccount = new Map<
    string,
    { account: string; added: number; first: string; last: string }
  >()
  for (const t of fresh) {
    const a = byAccount.get(t.account) ?? {
      account: t.account,
      added: 0,
      first: t.date,
      last: t.date,
    }
    a.added++
    if (t.date < a.first) a.first = t.date
    if (t.date > a.last) a.last = t.date
    byAccount.set(t.account, a)
  }

  const summary: ImportSummary = {
    fileName: input.fileName,
    rows: txns.length,
    added: fresh.length,
    alreadyHad: txns.length - fresh.length,
    skipped,
    from,
    to,
    newAccounts,
    byAccount: [...byAccount.values()].sort((a, b) => b.added - a.added),
  }
  if (!input.commit || fresh.length === 0) return summary

  const importId = `im_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const statements = []
  // A first import also brings in the starting Categories.
  statements.push(
    db
      .insert(categories)
      .values([...DEFAULT_CATEGORIES])
      .onConflictDoNothing(),
  )
  for (const name of newAccounts)
    statements.push(
      db
        .insert(accounts)
        .values({
          name,
          sourceName: sourceAccounts.get(name)!,
          owner: defaultOwner(name),
        })
        .onConflictDoNothing(),
    )
  for (const name of new Set(fresh.map((t) => t.sourceCategory)))
    statements.push(
      db.insert(categories).values(newCategory(name)).onConflictDoNothing(),
    )
  for (let i = 0; i < fresh.length; i += ROWS_PER_INSERT)
    statements.push(
      db
        .insert(transactions)
        .values(
          fresh
            .slice(i, i + ROWS_PER_INSERT)
            .map(({ accountSource: _source, ...t }) => ({
              ...t,
              importId,
            })),
        )
        .onConflictDoNothing(),
    )
  statements.push(
    db.insert(imports).values({
      id: importId,
      fileName: input.fileName,
      importedBy: input.importedBy,
      added: fresh.length,
      skipped: summary.alreadyHad,
    }),
  )
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    const chunk = statements.slice(i, i + STATEMENTS_PER_BATCH)
    await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk])
  }
  return summary
}
