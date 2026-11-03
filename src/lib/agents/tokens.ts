/**
 * API tokens for Agents (docs/adr/0004): a Member creates one, sees it
 * once, and gives it to their Agent; we keep only its SHA-256 hash. A token
 * belongs to one Household and works only while its creator remains a
 * Member; the MCP endpoint also enforces rollout admission rules.
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/lib/db'
import type { HouseholdDatabase } from '@/lib/households/scope'
import { apiTokens, householdMembers, households } from '@/lib/db/schema'
import { UserError } from '@/lib/errors'
import { authorizationBearer, digestHex, prefixedToken } from '@/lib/secret'

/** Marks a Budgy token, so a leaked one is easy to spot and scan for. */
const TOKEN_PREFIX = 'bg_'
/** How much of a token is shown on screen to tell tokens apart. */
const SHOWN_CHARS = 10
/** Don't rewrite last_used_at more often than this. */
const TOUCH_EVERY_MS = 60_000

/** A well-formed token; anything else is refused before the database. */
export const TOKEN_PATTERN = /^bg_[A-Za-z0-9_-]{43}$/

/** `read` sees the Ledger; `write` may also import and edit Transactions. */
export type TokenScope = 'read' | 'write'

/** A new random token: "bg_" and 32 random bytes, base64url. */
export function newToken(): string {
  return prefixedToken(TOKEN_PREFIX)
}

export function hashToken(token: string): Promise<string> {
  return digestHex('SHA-256', token)
}

/** The token from an `Authorization: Bearer …` header, if it's one of ours. */
export function bearerToken(header: string | null): string | null {
  return authorizationBearer(header, TOKEN_PREFIX)
}

/** Enough for a few Agents; more is likely tokens nobody revoked. */
export const MAX_ACTIVE_TOKENS = 10

/**
 * Store a new token for a Member; returns it, the only time it's seen. The
 * limit is checked in the insert itself, so simultaneous requests can't
 * pass it together.
 */
export async function createToken(
  db: HouseholdDatabase,
  member: { id: string; email: string },
  name: string,
  scopes: Array<TokenScope> = ['read'],
  now = new Date(),
): Promise<{ id: string; token: string }> {
  const token = newToken()
  const id = crypto.randomUUID()
  const inserted = await db
    .insert(apiTokens)
    .select(
      db
        .select({
          householdId: households.id,
          id: sql<string>`${id}`.as('id'),
          memberId: sql<string>`${member.id}`.as('member_id'),
          memberEmail: sql<string>`${member.email}`.as('member_email'),
          name: sql<string>`${name}`.as('name'),
          tokenHash: sql<string>`${await hashToken(token)}`.as('token_hash'),
          prefix: sql<string>`${token.slice(0, SHOWN_CHARS)}`.as('prefix'),
          scopes: sql<Array<TokenScope>>`${JSON.stringify(scopes)}`.as(
            'scopes',
          ),
          createdAt: sql<string>`${now.toISOString()}`.as('created_at'),
          lastUsedAt: sql<string | null>`null`.as('last_used_at'),
          revokedAt: sql<string | null>`null`.as('revoked_at'),
        })
        .from(households)
        .where(
          and(
            eq(households.id, db.householdId),
            sql`(select count(*) from ${apiTokens} where ${apiTokens.householdId} = ${db.householdId} and ${apiTokens.memberId} = ${member.id} and ${apiTokens.revokedAt} is null) < ${MAX_ACTIVE_TOKENS}`,
          ),
        ),
    )
    .returning({ id: apiTokens.id })
  if (!inserted.length)
    throw new UserError(
      `You have ${MAX_ACTIVE_TOKENS} tokens: revoke one to make another`,
    )
  return { id, token }
}

export interface Caller {
  householdId: string
  tokenId: string
  /** What the Member called the token: how its Agent is named to them. */
  agentName: string
  memberId: string
  memberEmail: string
  scopes: Array<TokenScope>
}

/** Whose token this is and what it may do, or null if unknown or revoked. */
export async function verifyToken(
  db: Database,
  token: string,
  now = new Date(),
): Promise<Caller | null> {
  if (!TOKEN_PATTERN.test(token)) return null
  const row = await db
    .select()
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.tokenHash, await hashToken(token)),
        isNull(apiTokens.revokedAt),
      ),
    )
    .get()
  if (!row) return null
  const membership = await db
    .select({ memberId: householdMembers.memberId })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, row.householdId),
        eq(householdMembers.memberId, row.memberId),
      ),
    )
    .get()
  if (!membership) return null
  const lastUsed = row.lastUsedAt ? Date.parse(row.lastUsedAt) : 0
  if (now.getTime() - lastUsed > TOUCH_EVERY_MS) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: now.toISOString() })
      .where(eq(apiTokens.id, row.id))
  }
  return {
    householdId: row.householdId,
    tokenId: row.id,
    agentName: row.name,
    memberId: row.memberId,
    memberEmail: row.memberEmail,
    scopes: row.scopes,
  }
}
