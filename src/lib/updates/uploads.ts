/**
 * Upload tokens for the iPhone share-sheet Shortcut (docs/adr/0010): each
 * one may only send CSV exports to one Account, in one format. It can't read
 * anything, and the request body never chooses the Household or Account.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '@/lib/db'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { ExportFormat } from './exports'
import { hashToken, newToken } from '@/lib/agents/tokens'
import { accounts, householdMembers, uploadTokens } from '@/lib/db/schema'
import { householdRow, inHousehold } from '@/lib/households/scope'
import { findAccount } from '@/lib/ledger/accounts'

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
  if (account.closed) throw new Error('Reopen this Account before updating it')
  if (!['credit', 'checking', 'savings'].includes(account.kind))
    throw new Error('Only card and bank Accounts take purchase exports')
  if (format === 'apple-card' && account.kind !== 'credit')
    throw new Error('Choose a credit-card Account for an Apple Card export')
  const active = await db
    .select({ id: uploadTokens.id })
    .from(uploadTokens)
    .where(
      inHousehold(
        db,
        uploadTokens,
        and(
          eq(uploadTokens.account, account.name),
          isNull(uploadTokens.revokedAt),
        ),
      ),
    )
  if (active.length >= MAX_ACTIVE_PER_ACCOUNT)
    throw new Error(
      `${account.name} already has ${MAX_ACTIVE_PER_ACCOUNT} Shortcut tokens. Revoke one you no longer use.`,
    )
  const token = UPLOAD_PREFIX + newToken().slice(3)
  const id = crypto.randomUUID()
  await db.insert(uploadTokens).values(
    householdRow(db, {
      id,
      account: account.name,
      format,
      memberId: member.id,
      memberEmail: member.email,
      tokenHash: await hashToken(token),
      prefix: token.slice(0, SHOWN_CHARS),
    }),
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
      memberEmail: uploadTokens.memberEmail,
    })
    .from(uploadTokens)
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
