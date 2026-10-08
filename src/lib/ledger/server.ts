/**
 * Server functions for the Household's Ledger. Every Member reads and edits
 * the same rows; each call checks the session against the allowlist first
 * (docs/adr/0001).
 */

import { createServerFn } from '@tanstack/react-start'
import { and, between, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '@/lib/db'
import type { Ledger, Plan, StoreRule } from '@/lib/model/types'
import type { SessionState } from '@/lib/auth/session'
import type { ImportRules } from '@/lib/import/rules'
import { sessionState, withMember } from '@/lib/auth/session'
import {
  accounts,
  budgetTargets,
  categories,
  imports,
  plannedExpenses,
  settings,
  storeRules,
  transactions,
} from '@/lib/db/schema'
import { CADENCES, TAGS } from '@/lib/model/types'
import { DEFAULT_CATEGORIES, newCategory } from '@/lib/model/defaults'
import { ImportError, parseExport } from '@/lib/import/rows'
import { importRulesSchema, parseImportRules } from '@/lib/import/rules'
import { defaultOwner } from '@/lib/import/stores'

export type { SessionState } from '@/lib/auth/session'

export const getSession = createServerFn({ method: 'GET' }).handler(
  (): Promise<SessionState> => sessionState(),
)

export const getLedger = createServerFn({ method: 'GET' }).handler(() =>
  withMember(async ({ db }): Promise<Ledger> => {
    const [cats, accts, txns, rules, targets, plans] = await Promise.all([
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
      db.select().from(storeRules),
      db.select().from(budgetTargets),
      db.select().from(plannedExpenses).orderBy(plannedExpenses.createdAt),
    ])
    return {
      categories: cats.map(({ name, tag, group }) => ({ name, tag, group })),
      accounts: accts.map(({ name, sourceName, owner }) => ({
        name,
        sourceName,
        owner,
      })),
      txns,
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
  }),
)

const NAME = z.string().trim().min(1).max(60)
const TAG = z
  .enum(TAGS as [string, ...Array<string>])
  .transform((t) => t as (typeof TAGS)[number])
const MONTH = z.string().regex(/^\d{4}-\d{2}$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const CENTS = z.number().int().min(0).max(100_000_000)

/** A Category named in an edit exists from then on. */
async function ensureCategory(db: Database, name: string): Promise<void> {
  await db.insert(categories).values(newCategory(name)).onConflictDoNothing()
}

/** Move one Transaction to a Category (null: back to its Store's). */
export const moveTxn = createServerFn({ method: 'POST' })
  .validator((data: { id: string; category: string | null }) =>
    z.object({ id: z.string().max(16), category: NAME.nullable() }).parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      if (data.category) await ensureCategory(db, data.category)
      await db
        .update(transactions)
        .set({ category: data.category })
        .where(eq(transactions.id, data.id))
    }),
  )

export const noteTxn = createServerFn({ method: 'POST' })
  .validator((data: { id: string; note: string | null }) =>
    z
      .object({
        id: z.string().max(16),
        note: z.string().trim().max(200).nullable(),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await db
        .update(transactions)
        .set({ note: data.note || null })
        .where(eq(transactions.id, data.id))
    }),
  )

/** Change a Store Rule; a field left out keeps its value, null clears it. */
export const setStoreRule = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      sourceCategory: string
      store: string
      category?: string | null
      tag?: StoreRule['tag']
    }) =>
      z
        .object({
          sourceCategory: NAME,
          store: z.string().min(1).max(80),
          category: NAME.nullable().optional(),
          tag: TAG.nullable().optional(),
        })
        .parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      const key = and(
        eq(storeRules.sourceCategory, data.sourceCategory),
        eq(storeRules.store, data.store),
      )
      const current = await db.select().from(storeRules).where(key).get()
      const next = {
        sourceCategory: data.sourceCategory,
        store: data.store,
        category:
          data.category === undefined
            ? (current?.category ?? null)
            : data.category,
        tag: data.tag === undefined ? (current?.tag ?? null) : data.tag,
      }
      if (next.category === data.sourceCategory) next.category = null
      if (next.category) await ensureCategory(db, next.category)
      if (!next.category && !next.tag) {
        await db.delete(storeRules).where(key)
        return
      }
      await db
        .insert(storeRules)
        .values(next)
        .onConflictDoUpdate({
          target: [storeRules.sourceCategory, storeRules.store],
          set: { category: next.category, tag: next.tag },
        })
    }),
  )

/** Set a Category's Target from a month on; null removes that month's row. */
export const setTarget = createServerFn({ method: 'POST' })
  .validator(
    (data: { category: string; startsMonth: string; amount: number | null }) =>
      z
        .object({
          category: NAME,
          startsMonth: MONTH,
          amount: CENTS.nullable(),
        })
        .parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      const key = and(
        eq(budgetTargets.category, data.category),
        eq(budgetTargets.startsMonth, data.startsMonth),
      )
      if (data.amount === null) {
        await db.delete(budgetTargets).where(key)
        return
      }
      await ensureCategory(db, data.category)
      await db
        .insert(budgetTargets)
        .values({ ...data, amount: data.amount })
        .onConflictDoUpdate({
          target: [budgetTargets.category, budgetTargets.startsMonth],
          set: { amount: data.amount },
        })
    }),
  )

export const saveCategory = createServerFn({ method: 'POST' })
  .validator(
    (data: { name: string; tag: string; group: 'everyday' | 'housing' }) =>
      z
        .object({
          name: NAME,
          tag: TAG,
          group: z.enum(['everyday', 'housing']),
        })
        .parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await db
        .insert(categories)
        .values(data)
        .onConflictDoUpdate({
          target: categories.name,
          set: { tag: data.tag, group: data.group },
        })
    }),
  )

export const setAccountOwner = createServerFn({ method: 'POST' })
  .validator((data: { account: string; owner: string }) =>
    z.object({ account: NAME, owner: NAME }).parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await db
        .update(accounts)
        .set({ owner: data.owner })
        .where(eq(accounts.name, data.account))
    }),
  )

const planInput = z.object({
  id: z.string().regex(/^pe_[a-z0-9]{6,24}$/),
  name: NAME,
  category: NAME,
  store: z.string().min(1).max(80).nullable(),
  amount: CENTS.min(1),
  cadence: z
    .enum(CADENCES as [string, ...Array<string>])
    .transform((c) => c as Plan['cadence']),
  anchor: DATE,
  active: z.boolean(),
})

export const savePlan = createServerFn({ method: 'POST' })
  .validator((data: Plan) => planInput.parse(data))
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await ensureCategory(db, data.category)
      const { id, ...rest } = data
      await db
        .insert(plannedExpenses)
        .values(data)
        .onConflictDoUpdate({ target: plannedExpenses.id, set: rest })
    }),
  )

export const deletePlan = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().max(32) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await db.delete(plannedExpenses).where(eq(plannedExpenses.id, data.id))
    }),
  )

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

/**
 * Read an export and, with `commit`, add the Transactions the Ledger doesn't
 * have yet. Without it, only say what would happen.
 */
export const importCsv = createServerFn({ method: 'POST' })
  .validator((data: { fileName: string; text: string; commit: boolean }) =>
    z
      .object({
        fileName: z.string().max(200),
        text: z.string().max(8_000_000),
        commit: z.boolean(),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db, member }): Promise<ImportSummary> => {
      let parsed
      try {
        parsed = await parseExport(data.text, await loadImportRules(db))
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

      const sourceAccounts = new Map(
        txns.map((t) => [t.account, t.accountSource]),
      )
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
      const newAccounts = [...sourceAccounts.keys()].filter(
        (a) => !known.has(a),
      )

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
        fileName: data.fileName,
        rows: txns.length,
        added: fresh.length,
        alreadyHad: txns.length - fresh.length,
        skipped,
        from,
        to,
        newAccounts,
        byAccount: [...byAccount.values()].sort((a, b) => b.added - a.added),
      }
      if (!data.commit || fresh.length === 0) return summary

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
          fileName: data.fileName,
          importedBy: member.email,
          added: fresh.length,
          skipped: summary.alreadyHad,
        }),
      )
      for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
        const chunk = statements.slice(i, i + STATEMENTS_PER_BATCH)
        await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk])
      }
      return summary
    }),
  )

export interface ImportRecord {
  id: string
  fileName: string
  importedBy: string
  added: number
  skipped: number
  createdAt: string
}

export const listImports = createServerFn({ method: 'GET' }).handler(() =>
  withMember(async ({ db }): Promise<Array<ImportRecord>> => {
    const rows = await db
      .select()
      .from(imports)
      .orderBy(sql`${imports.createdAt} desc`)
      .limit(20)
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  }),
)

const RULES_KEY = 'import_rules'

async function loadImportRules(db: Database): Promise<ImportRules> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, RULES_KEY))
    .get()
  return parseImportRules(row?.value)
}

export const getImportRules = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db }) => loadImportRules(db)),
)

/**
 * Replace the Import Rules. They shape future imports only: Transactions
 * already imported keep their Store and Category.
 */
export const setImportRules = createServerFn({ method: 'POST' })
  .validator((data: ImportRules) => importRulesSchema.parse(data))
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      const value = JSON.stringify(data)
      await db
        .insert(settings)
        .values({ key: RULES_KEY, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
    }),
  )
