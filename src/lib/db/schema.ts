/**
 * Drizzle schema for the Cloudflare D1 database: the single source of truth
 * for the database shape, drizzle-kit migrations and the Better Auth adapter.
 *
 * Better Auth tables are owned by Better Auth (copied from sportsline; do not
 * hand-edit their shapes). Everything else is the Household's one shared
 * Ledger (CONTEXT.md; docs/adr/0001): Members see and edit the same rows.
 * Money is integer cents; a Transaction's amount is positive for spending
 * and negative for a refund.
 */

import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import type { Cadence, Group, Tag } from '@/lib/model/types'

// ─── Better Auth (generated; do not hand-edit shapes) ───────────────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .default(false)
    .notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

// ─── Ledger ─────────────────────────────────────────────────────────────────

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull()

/** Budget Categories, by name (names are the key; no renames yet). */
export const categories = sqliteTable('categories', {
  name: text('name').primaryKey(),
  tag: text('tag').$type<Tag>().notNull(),
  group: text('group').$type<Group>().notNull(),
  createdAt: createdAt(),
})

/** A card or bank Account a Transaction came from, and whose spending it is. */
export const accounts = sqliteTable('accounts', {
  /** Short name, e.g. "Blaze Apple Card". */
  name: text('name').primaryKey(),
  /** The finance app's full account name, as exported. */
  sourceName: text('source_name').notNull(),
  /** "Joint" or a Member's first name. */
  owner: text('owner').notNull(),
  createdAt: createdAt(),
})

export const transactions = sqliteTable(
  'transactions',
  {
    /** Stable hash of the exported row (src/lib/import/rows.ts). */
    id: text('id').primaryKey(),
    /** YYYY-MM-DD */
    date: text('date').notNull(),
    /** YYYY-MM, for month queries. */
    month: text('month').notNull(),
    account: text('account').notNull(),
    description: text('description').notNull(),
    /** Normalized Store name. */
    store: text('store').notNull(),
    /** The Category the import gave it, before any Moves. */
    sourceCategory: text('source_category').notNull(),
    amount: integer('amount').notNull(),
    /** A Move of this one Transaction (wins over a Store Rule). */
    category: text('category'),
    note: text('note'),
    importId: text('import_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('transactions_month_idx').on(t.month)],
)

/**
 * A Store Rule moves (or re-tags) every Transaction from one Store that the
 * import put in one Category, past and future.
 */
export const storeRules = sqliteTable(
  'store_rules',
  {
    sourceCategory: text('source_category').notNull(),
    store: text('store').notNull(),
    category: text('category'),
    tag: text('tag').$type<Tag>(),
  },
  (t) => [primaryKey({ columns: [t.sourceCategory, t.store] })],
)

/**
 * A Category's monthly Target from `startsMonth` on, until a later row
 * replaces it: the Budget's history.
 */
export const budgetTargets = sqliteTable(
  'budget_targets',
  {
    category: text('category').notNull(),
    /** YYYY-MM */
    startsMonth: text('starts_month').notNull(),
    amount: integer('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.category, t.startsMonth] })],
)

/**
 * A Planned Expense: a known, usually lumpy bill (car insurance twice a
 * year) that is budgeted on its due dates rather than in the monthly Target
 * (docs/adr/0002).
 */
export const plannedExpenses = sqliteTable('planned_expenses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  /** Payments from this Store are matched to it; null matches on amount. */
  store: text('store'),
  amount: integer('amount').notNull(),
  cadence: text('cadence').$type<Cadence>().notNull(),
  /** Any one due date (YYYY-MM-DD); the others step from it by cadence. */
  anchor: text('anchor').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
})

export const imports = sqliteTable('imports', {
  id: text('id').primaryKey(),
  fileName: text('file_name').notNull(),
  importedBy: text('imported_by').notNull(),
  added: integer('added').notNull(),
  skipped: integer('skipped').notNull(),
  createdAt: createdAt(),
})

/** Household settings by key; `import_rules` holds the Import Rules (JSON). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})
