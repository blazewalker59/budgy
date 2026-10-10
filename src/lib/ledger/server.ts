/**
 * Server functions for the Household's Ledger. Every Member reads and edits
 * the same rows within their Household; each call checks both the session
 * allowlist and Household membership (docs/adr/0007).
 */

import { createServerFn } from '@tanstack/react-start'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  ensureCategory,
  loadLedger,
  moveTransaction,
  noteTransaction,
} from './queries'
import { RULES_KEY, loadImportRules } from './importer'
import {
  clearBalances as clearBalanceRows,
  deleteAccount as deleteAccountRow,
  deleteBalance as deleteBalanceRow,
  postTransactions,
  recordBalances as recordBalanceRows,
  removeStarting,
  saveAccount as saveAccountRow,
} from './accounts'
import type {
  Account,
  Balance,
  PaySchedule,
  Plan,
  SavedLens,
  StoreRule,
} from '@/lib/model/types'
import type { SessionState } from '@/lib/auth/session'
import type { ImportRules } from '@/lib/import/rules'
import { savedLensInput } from '@/lib/model/lens'
import { ANY_SOURCE } from '@/lib/model/ledger'
import { accountInput, balanceInput } from '@/lib/model/accounts'
import { sessionState, withMember } from '@/lib/auth/session'
import {
  budgetTargets,
  categories,
  paySchedules,
  plannedExpenses,
  savedLenses,
  settings,
  storeRules,
  transactions,
} from '@/lib/db/schema'
import { CADENCES, TAGS } from '@/lib/model/types'
import { payInput } from '@/lib/model/pay'
import { importRulesSchema } from '@/lib/import/rules'
import { postedRowInput } from '@/lib/import/posted'
import { householdRow, inHousehold } from '@/lib/households/scope'

export type { PostSummary } from './accounts'

export type { SessionState } from '@/lib/auth/session'

export const getSession = createServerFn({ method: 'GET' }).handler(
  (): Promise<SessionState> => sessionState(),
)

export const getLedger = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db }) => loadLedger(db)),
)

const NAME = z.string().trim().min(1).max(60)
const TAG = z
  .enum(TAGS as [string, ...Array<string>])
  .transform((t) => t as (typeof TAGS)[number])
const MONTH = z.string().regex(/^\d{4}-\d{2}$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const CENTS = z.number().int().min(0).max(100_000_000)

/** Move one Transaction to a Category (null: back to its Store's). */
export const moveTxn = createServerFn({ method: 'POST' })
  .validator((data: { id: string; category: string | null }) =>
    z.object({ id: z.string().max(16), category: NAME.nullable() }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) => moveTransaction(db, data.id, data.category)),
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
    withMember(({ db }) => noteTransaction(db, data.id, data.note)),
  )

/**
 * Change a Store Rule; a field left out keeps its value, null clears it.
 * `sourceCategory` ANY_SOURCE makes it store-wide.
 */
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
        inHousehold(db, storeRules),
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
        .values(householdRow(db, next))
        .onConflictDoUpdate({
          target: [
            storeRules.householdId,
            storeRules.sourceCategory,
            storeRules.store,
          ],
          set: { category: next.category, tag: next.tag },
        })
      // A store-wide rule makes Moves of that Store to the same place
      // redundant; Moves elsewhere stay as the exceptions they are.
      if (data.sourceCategory === ANY_SOURCE && next.category)
        await db
          .update(transactions)
          .set({ category: null })
          .where(
            and(
              sql`lower(${transactions.store}) = lower(${data.store})`,
              inHousehold(db, transactions),
              eq(transactions.category, next.category),
            ),
          )
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
        inHousehold(db, budgetTargets),
        eq(budgetTargets.startsMonth, data.startsMonth),
      )
      if (data.amount === null) {
        await db.delete(budgetTargets).where(key)
        return
      }
      await ensureCategory(db, data.category)
      await db
        .insert(budgetTargets)
        .values(householdRow(db, { ...data, amount: data.amount }))
        .onConflictDoUpdate({
          target: [
            budgetTargets.householdId,
            budgetTargets.category,
            budgetTargets.startsMonth,
          ],
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
        .values(householdRow(db, data))
        .onConflictDoUpdate({
          target: [categories.householdId, categories.name],
          set: { tag: data.tag, group: data.group },
        })
    }),
  )

export type AccountEdit = Omit<Account, 'sourceName'> & { isNew: boolean }

/** Add an Account, or change one's owner, kind, institution or closing. */
export const saveAccount = createServerFn({ method: 'POST' })
  .validator((data: AccountEdit) =>
    accountInput.extend({ isNew: z.boolean() }).parse(data),
  )
  .handler(({ data: { isNew, ...account } }) =>
    withMember(({ db }) => saveAccountRow(db, account, isNew)),
  )

/** Save the Lens under a name (or rename one), for the whole Household. */
export const saveLens = createServerFn({ method: 'POST' })
  .validator((data: SavedLens) => savedLensInput.parse(data))
  .handler(({ data }) =>
    withMember(async ({ db, member }) => {
      await db
        .insert(savedLenses)
        .values(householdRow(db, { ...data, createdBy: member.email }))
        .onConflictDoUpdate({
          target: [savedLenses.householdId, savedLenses.id],
          set: { name: data.name, lens: data.lens },
        })
    }),
  )

export const deleteLens = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().max(32) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await db
        .delete(savedLenses)
        .where(inHousehold(db, savedLenses, eq(savedLenses.id, data.id)))
    }),
  )

/** Remove an Account added by mistake (one with no purchases). */
export const deleteAccount = createServerFn({ method: 'POST' })
  .validator((data: { name: string }) =>
    accountInput.pick({ name: true }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) => deleteAccountRow(db, data.name)),
  )

/**
 * Record Balances for one Account: today's, or a whole imported history,
 * which with `replace` takes the place of the Account's earlier ones.
 */
export const recordBalances = createServerFn({ method: 'POST' })
  .validator((data: { balances: Array<Balance>; replace?: string }) =>
    z
      .object({
        balances: z.array(balanceInput).max(5000),
        replace: z.string().trim().min(1).max(60).optional(),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db, member }) => {
      if (data.replace) await clearBalanceRows(db, data.replace)
      await recordBalanceRows(db, data.balances, member.email)
    }),
  )

export const deleteBalance = createServerFn({ method: 'POST' })
  .validator((data: { account: string; date: string }) =>
    balanceInput.pick({ account: true, date: true }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) => deleteBalanceRow(db, data.account, data.date)),
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
        .values(householdRow(db, data))
        .onConflictDoUpdate({
          target: [plannedExpenses.householdId, plannedExpenses.id],
          set: rest,
        })
    }),
  )

export const deletePlan = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().max(32) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await db
        .delete(plannedExpenses)
        .where(
          inHousehold(db, plannedExpenses, eq(plannedExpenses.id, data.id)),
        )
    }),
  )

/** Add or change a Pay Schedule: take-home pay comes only from these. */
export const savePay = createServerFn({ method: 'POST' })
  .validator((data: PaySchedule) => payInput.parse(data))
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      const { id, ...rest } = data
      await db
        .insert(paySchedules)
        .values(householdRow(db, data))
        .onConflictDoUpdate({
          target: [paySchedules.householdId, paySchedules.id],
          set: rest,
        })
    }),
  )

export const deletePay = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().max(32) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db }) => {
      await db
        .delete(paySchedules)
        .where(inHousehold(db, paySchedules, eq(paySchedules.id, data.id)))
    }),
  )

/**
 * One Account's purchases from its uploaded export. Without `commit`, only
 * say what would happen.
 */
export const uploadPurchases = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      account: string
      rows: Array<z.input<typeof postedRowInput>>
      commit: boolean
      replaceStarting: boolean
    }) =>
      z
        .object({
          account: z.string().min(1).max(60),
          rows: z.array(postedRowInput).max(20_000),
          commit: z.boolean(),
          replaceStarting: z.boolean(),
        })
        .parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db, member }) =>
      postTransactions(db, {
        ...data,
        importedBy: member.email,
        via: 'uploaded',
      }),
    ),
  )

/**
 * Take out the starting purchases (the whole-household export Budgy began
 * with) still here: one Account's, or every one.
 */
export const removeStartingPurchases = createServerFn({ method: 'POST' })
  .validator((data: { account?: string }) =>
    z.object({ account: z.string().min(1).max(60).optional() }).parse(data),
  )
  .handler(({ data }) =>
    withMember(({ db }) => removeStarting(db, data.account)),
  )

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
        .values(householdRow(db, { key: RULES_KEY, value }))
        .onConflictDoUpdate({
          target: [settings.householdId, settings.key],
          set: { value },
        })
    }),
  )
