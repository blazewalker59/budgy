/**
 * Upload tokens for the iPhone share-sheet Shortcut (docs/adr/0010): each
 * one may only send CSV exports to one Account, in one format. It can't read
 * anything, and the request body never chooses the Household or Account.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { ExportFormat } from './exports'
import { hashToken } from '@/lib/agents/tokens'
import { prefixedToken } from '@/lib/secret'
import {
  accounts,
  householdMembers,
  households,
  uploadTokens,
  user,
} from '@/lib/db/schema'
import { inHousehold } from '@/lib/households/scope'
import { findAccount } from '@/lib/ledger/accounts'
import { UserError } from '@/lib/errors'

/** Distinct from Agent tokens (bg_), so neither is accepted for the other. */
const UPLOAD_PREFIX = 'bu_'
const SHOWN_CHARS = 10
/** A phone or two per Account; more is likely tokens nobody revoked. */
const MAX_ACTIVE_PER_ACCOUNT = 5
export const UPLOAD_TOKEN_PATTERN = /^bu_[A-Za-z0-9_-]{43}$/

export async function createUploadToken(
  db: HouseholdDatabase,
  member: { id: string; email: string },
  accountName: string,
  format: ExportFormat,
): Promise<{ id: string; token: string; account: string }> {
  const account = await findAccount(db, accountName)
  if (account.closed) throw new UserError('Reopen this account to update it.')
  if (!['credit', 'checking', 'savings'].includes(account.kind))
    throw new UserError('Only card and bank accounts take purchase exports.')
  if (format === 'apple-card' && account.kind !== 'credit')
    throw new UserError(
      'Apple Card exports only work with a credit card account.',
    )
  const token = prefixedToken(UPLOAD_PREFIX)
  const id = crypto.randomUUID()
  // The limit is checked in the insert itself, so simultaneous requests
  // can't pass it together.
  const inserted = await db
    .insert(uploadTokens)
    .select(
      db
        .select({
          householdId: households.id,
          id: sql<string>`${id}`.as('id'),
          account: sql<string>`${account.name}`.as('account'),
          format: sql<ExportFormat>`${format}`.as('format'),
          memberId: sql<string>`${member.id}`.as('member_id'),
          memberEmail: sql<string>`${member.email}`.as('member_email'),
          tokenHash: sql<string>`${await hashToken(token)}`.as('token_hash'),
          prefix: sql<string>`${token.slice(0, SHOWN_CHARS)}`.as('prefix'),
          createdAt:
            sql<Date>`cast(unixepoch('subsecond') * 1000 as integer)`.as(
              'created_at',
            ),
          lastUsedAt: sql<Date | null>`null`.as('last_used_at'),
          revokedAt: sql<Date | null>`null`.as('revoked_at'),
        })
        .from(households)
        .where(
          and(
            eq(households.id, db.householdId),
            sql`(select count(*) from ${uploadTokens} where ${uploadTokens.householdId} = ${db.householdId} and ${uploadTokens.account} = ${account.name} and ${uploadTokens.revokedAt} is null) < ${MAX_ACTIVE_PER_ACCOUNT}`,
          ),
        ),
    )
    .returning({ id: uploadTokens.id })
  if (!inserted.length)
    throw new UserError(
      `${account.name} already has ${MAX_ACTIVE_PER_ACCOUNT} Shortcut tokens. Revoke one you no longer use.`,
    )
  return { id, token, account: account.name }
}

export function listUploadTokens(db: HouseholdDatabase) {
  return db
    .select({
      id: uploadTokens.id,
      account: uploadTokens.account,
      format: uploadTokens.format,
      memberEmail: uploadTokens.memberEmail,
      prefix: uploadTokens.prefix,
      createdAt: uploadTokens.createdAt,
      lastUsedAt: uploadTokens.lastUsedAt,
    })
    .from(uploadTokens)
    .where(inHousehold(db, uploadTokens, isNull(uploadTokens.revokedAt)))
    .orderBy(desc(uploadTokens.createdAt))
}

export async function revokeUploadToken(db: HouseholdDatabase, id: string) {
  await db
    .update(uploadTokens)
    .set({ revokedAt: new Date() })
    .where(inHousehold(db, uploadTokens, eq(uploadTokens.id, id)))
}

export interface Uploader {
  id: string
  householdId: string
  account: string
  format: ExportFormat
  memberEmail: string
}

/**
 * The token's Household, Account and format, or null when it's unknown,
 * revoked, its creator left the Household, or its Account was closed.
 */
export async function verifyUploadToken(
  db: Database,
  token: string,
): Promise<Uploader | null> {
  if (!UPLOAD_TOKEN_PATTERN.test(token)) return null
  const row = await db
    .select({
      id: uploadTokens.id,
      householdId: uploadTokens.householdId,
      account: uploadTokens.account,
      format: uploadTokens.format,
      // The creator's email now: admission is decided on the current one.
      memberEmail: user.email,
    })
    .from(uploadTokens)
    .innerJoin(user, eq(user.id, uploadTokens.memberId))
    .innerJoin(
      householdMembers,
      and(
        eq(householdMembers.householdId, uploadTokens.householdId),
        eq(householdMembers.memberId, uploadTokens.memberId),
      ),
    )
    .innerJoin(
      accounts,
      and(
        eq(accounts.householdId, uploadTokens.householdId),
        eq(accounts.name, uploadTokens.account),
      ),
    )
    .where(
      and(
        eq(uploadTokens.tokenHash, await hashToken(token)),
        isNull(uploadTokens.revokedAt),
        eq(accounts.closed, false),
      ),
    )
    .get()
  return row ?? null
}
