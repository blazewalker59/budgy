/**
 * Drizzle schema for the Cloudflare D1 database: the single source of truth
 * for the database shape, drizzle-kit migrations and the Better Auth adapter.
 *
 * Better Auth tables are owned by Better Auth (copied from sportsline; do not
 * hand-edit their shapes). Ledger rows belong to one Household; its Members
 * see and edit the same rows (docs/adr/0007).
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
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type { Lens } from '@/lib/model/lens'
import type { ExportFormat } from '@/lib/updates/exports'
import type {
  AccountKind,
  Cadence,
  Group,
  PayCadence,
  Tag,
} from '@/lib/model/types'

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

export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /**
   * IANA zone for this Household's "today": sync, the digest, and the UI.
   * The original Household stays on America/New_York (0015).
   */
  timeZone: text('time_zone').notNull().default('America/New_York'),
  /**
   * JSON array of spending owners ("Joint", members, a child). Import turns
   * any of these except Joint into a "<name> personal" Category.
   */
  owners: text('owners').notNull().default('["Joint"]'),
  createdAt: createdAt(),
})

export const householdMembers = sqliteTable(
  'household_members',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    memberId: text('member_id').notNull(),
    role: text('role').$type<'owner' | 'member'>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.memberId] }),
    uniqueIndex('household_members_member_unique').on(t.memberId),
  ],
)

export const householdInvites = sqliteTable(
  'household_invites',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('household_invites_email_idx').on(t.email),
    index('household_invites_household_idx').on(t.householdId),
  ],
)

const householdId = () =>
  text('household_id')
    .notNull()
    .references(() => households.id)

/** Budget Categories, by name (names are the key; no renames yet). */
export const categories = sqliteTable(
  'categories',
  {
    householdId: householdId(),
    name: text('name').notNull(),
    tag: text('tag').$type<Tag>().notNull(),
    group: text('group').$type<Group>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.name] })],
)

/** A card or bank Account a Transaction came from, and whose spending it is. */
export const accounts = sqliteTable(
  'accounts',
  {
    householdId: householdId(),
    /** Short name, e.g. "Blaze Apple Card". */
    name: text('name').notNull(),
    /** The finance app's full account name, as exported. */
    sourceName: text('source_name').notNull(),
    /** "Joint", a Member's first name, or (say, for a 529) a child's. */
    owner: text('owner').notNull(),
    kind: text('kind').$type<AccountKind>().notNull().default('other'),
    /** The bank or brokerage, e.g. "Acme Brokerage". */
    institution: text('institution'),
    /** Closed Accounts keep their history but leave the totals. */
    closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
    /** A loan's property (a mortgage's home), for that property's equity. */
    securedBy: text('secured_by'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.name] })],
)

/**
 * What an Account held (or, for a card or loan, owed) on a day, as a Member
 * or an Agent recorded it. The latest one is its balance; together they're
 * the Household's net worth over time.
 */
export const balances = sqliteTable(
  'balances',
  {
    householdId: householdId(),
    account: text('account').notNull(),
    /** YYYY-MM-DD */
    date: text('date').notNull(),
    /** Cents, as the account shows it: a card's balance owed is positive. */
    amount: integer('amount').notNull(),
    recordedBy: text('recorded_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.account, t.date] })],
)

export const transactions = sqliteTable(
  'transactions',
  {
    householdId: householdId(),
    /** Stable hash of the exported row (src/lib/import/rows.ts). */
    id: text('id').notNull(),
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
    /** A connector's stable, namespaced identity; null for legacy exports. */
    sourceKey: text('source_key'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    index('transactions_month_idx').on(t.householdId, t.month),
    uniqueIndex('transactions_source_unique').on(
      t.householdId,
      t.account,
      t.sourceKey,
    ),
  ],
)

/** Receipts are distinct from purchase dates: an empty update is still a check. */
export const accountUpdates = sqliteTable(
  'account_updates',
  {
    householdId: householdId(),
    id: text('id').notNull(),
    account: text('account').notNull(),
    source: text('source')
      .$type<'uploaded' | 'posted' | 'shortcut' | 'simplefin'>()
      .notNull(),
    status: text('status')
      .$type<'running' | 'succeeded' | 'attention' | 'failed'>()
      .notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    fromDate: text('from_date'),
    toDate: text('to_date'),
    added: integer('added').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    linked: integer('linked').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    review: integer('review').notNull().default(0),
    /** Safe operational message only; never raw bank responses or credentials. */
    message: text('message'),
    issues: text('issues', { mode: 'json' })
      .$type<
        Array<{
          date: string
          description: string
          amount: number
          reason: string
        }>
      >()
      .notNull()
      .default([]),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    index('account_updates_account_idx').on(
      t.householdId,
      t.account,
      t.startedAt,
    ),
  ],
)

/** Serialize writers for an Account; expired leases allow a crashed job to retry. */
export const accountUpdateLocks = sqliteTable(
  'account_update_locks',
  {
    householdId: householdId(),
    account: text('account').notNull(),
    token: text('token').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.account] })],
)

/** The chosen export convention is saved per Account, never guessed silently. */
export const accountInputs = sqliteTable(
  'account_inputs',
  {
    householdId: householdId(),
    account: text('account').notNull(),
    format: text('format').$type<ExportFormat>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.account] })],
)

/**
 * A Store Rule moves (or re-tags) every Transaction from one Store that the
 * import put in one Category, past and future.
 */
export const storeRules = sqliteTable(
  'store_rules',
  {
    householdId: householdId(),
    sourceCategory: text('source_category').notNull(),
    store: text('store').notNull(),
    category: text('category'),
    tag: text('tag').$type<Tag>(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.sourceCategory, t.store] })],
)

/**
 * A Category's monthly Target from `startsMonth` on, until a later row
 * replaces it: the Budget's history.
 */
export const budgetTargets = sqliteTable(
  'budget_targets',
  {
    householdId: householdId(),
    category: text('category').notNull(),
    /** YYYY-MM */
    startsMonth: text('starts_month').notNull(),
    amount: integer('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.category, t.startsMonth] })],
)

/**
 * A Planned Expense: a known, usually lumpy bill (car insurance twice a
 * year) that is budgeted on its due dates rather than in the monthly Target
 * (docs/adr/0002).
 */
export const plannedExpenses = sqliteTable(
  'planned_expenses',
  {
    householdId: householdId(),
    id: text('id').notNull(),
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
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
)

/**
 * A paycheck the Household counts on, entered by a Member: who, how much
 * lands in the bank, how often, and one payday to step from. Take-home pay
 * comes only from these (src/lib/model/pay.ts), never from imported deposits.
 */
export const paySchedules = sqliteTable(
  'pay_schedules',
  {
    householdId: householdId(),
    id: text('id').notNull(),
    /** Whose pay, e.g. "Blaze" or "Alex's bonus". */
    name: text('name').notNull(),
    /** Take-home per paycheck, in cents. */
    amount: integer('amount').notNull(),
    cadence: text('cadence').$type<PayCadence>().notNull(),
    /** Any one payday (YYYY-MM-DD); the others step from it. */
    anchor: text('anchor').notNull(),
    /** Twice a month only: the other payday's day of the month (31 = last). */
    secondDay: integer('second_day'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
)

/**
 * A Lens saved under a name ("Alex fun money"), shared by the Household and
 * found again through the palette.
 */
export const savedLenses = sqliteTable(
  'saved_lenses',
  {
    householdId: householdId(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    /** The Lens (src/lib/model/lens.ts) as JSON. */
    lens: text('lens', { mode: 'json' }).$type<Lens>().notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
)

export const imports = sqliteTable(
  'imports',
  {
    householdId: householdId(),
    id: text('id').notNull(),
    fileName: text('file_name').notNull(),
    /**
     * The one Account an upload or an Agent's post was for. Null for the
     * whole-household exports Budgy started from (the starting purchases).
     */
    account: text('account'),
    importedBy: text('imported_by').notNull(),
    added: integer('added').notNull(),
    skipped: integer('skipped').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
)

/** Household settings by key; `import_rules` holds the Import Rules (JSON). */
export const settings = sqliteTable(
  'settings',
  {
    householdId: householdId(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.key] })],
)

// ─── Agents (docs/adr/0004) ─────────────────────────────────────────────────

/** A Member's API token for an Agent: only its SHA-256 hash is kept. */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    householdId: householdId(),
    id: text('id').primaryKey(),
    /** The Member who made it; the token works only while they're allowed. */
    memberId: text('member_id').notNull(),
    memberEmail: text('member_email').notNull(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    /** The first characters, to tell tokens apart on screen. */
    prefix: text('prefix').notNull(),
    scopes: text('scopes', { mode: 'json' })
      .$type<Array<'read' | 'write'>>()
      .notNull(),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('api_tokens_member_idx').on(t.memberId)],
)

/**
 * A Shortcut's write-only CSV capability: one Household, one Account, one
 * export format. Like API tokens, only the SHA-256 hash is kept.
 */
export const uploadTokens = sqliteTable(
  'upload_tokens',
  {
    householdId: householdId(),
    id: text('id').primaryKey(),
    account: text('account').notNull(),
    format: text('format').$type<ExportFormat>().notNull(),
    /** The Member who made it; the token works only while they're allowed. */
    memberId: text('member_id').notNull(),
    memberEmail: text('member_email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    createdAt: createdAt(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('upload_tokens_account_idx').on(t.householdId, t.account)],
)

// ─── Bank connections (docs/adr/0010) ───────────────────────────────────────

/**
 * A SimpleFIN Bridge connection. Its access URL is a credential: stored only
 * encrypted with BANK_CONNECTION_KEY, bound to its Household and id.
 */
export const bankConnections = sqliteTable(
  'bank_connections',
  {
    householdId: householdId(),
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdBy: text('created_by').notNull(),
    encryptedAccess: text('encrypted_access').notNull(),
    /** The same Bridge access can't be connected twice, anywhere. */
    accessHash: text('access_hash').notNull().unique(),
    status: text('status').$type<'ready' | 'attention'>().notNull(),
    /** Safe operational message only; never a raw Bridge response. */
    lastError: text('last_error'),
    createdAt: createdAt(),
    lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp_ms' }),
    /** Bridge asks for at most 24 requests a day per connection. */
    requestDay: text('request_day'),
    requestCount: integer('request_count').notNull().default(0),
  },
  (t) => [index('bank_connections_household_idx').on(t.householdId)],
)

/**
 * An account SimpleFIN discovered. Discovery is metadata only; mapping it to
 * a Budgy Account is an explicit Member choice and imports nothing itself.
 */
export const bankAccounts = sqliteTable(
  'bank_accounts',
  {
    householdId: householdId(),
    connectionId: text('connection_id').notNull(),
    /** SimpleFIN's account id, stable within its connection. */
    providerId: text('provider_id').notNull(),
    name: text('name').notNull(),
    institution: text('institution').notNull(),
    currency: text('currency').notNull(),
    /** The Budgy Account it feeds, or null while unmapped. */
    account: text('account'),
    /** False once Bridge stops listing it; its mapping is kept. */
    present: integer('present', { mode: 'boolean' }).notNull().default(true),
    /** The last day a sync covered; the next one overlaps it. */
    syncedThrough: text('synced_through'),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.connectionId, t.providerId] }),
    uniqueIndex('bank_accounts_account_unique').on(t.householdId, t.account),
  ],
)
