/**
 * API tokens for Agents (docs/adr/0004): a Member creates one, sees it
 * once, and gives it to their Agent; we keep only its SHA-256 hash. A token
 * belongs to one Household and works only while its creator remains a
 * Member; the MCP endpoint also enforces rollout admission rules.
 */

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@/lib/db'
import type { HouseholdDatabase } from '@/lib/households/scope'
import { apiTokens, householdMembers } from '@/lib/db/schema'

/** Marks a Budgy token, so a leaked one is easy to spot and scan for. */
const TOKEN_PREFIX = 'bg_'
/** How much of a token is shown on screen to tell tokens apart. */
const SHOWN_CHARS = 10
/** Don't rewrite last_used_at more often than this. */
const TOUCH_EVERY_MS = 60_000

/** `read` sees the Ledger; `write` may also import and edit Transactions. */
export type TokenScope = 'read' | 'write'

/** A new random token: "bg_" and 32 random bytes, base64url. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const base64 = btoa(String.fromCharCode(...bytes))
  return (
    TOKEN_PREFIX +
    base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  )
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** The token from an `Authorization: Bearer …` header, if it's one of ours. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  const token = match?.[1] ?? null
  return token?.startsWith(TOKEN_PREFIX) ? token : null
}

/** Store a new token for a Member; returns it, the only time it's seen. */
export async function createToken(
  db: HouseholdDatabase,
  member: { id: string; email: string },
  name: string,
  scopes: Array<TokenScope> = ['read'],
  now = new Date(),
): Promise<{ id: string; token: string }> {
  const token = newToken()
  const id = crypto.randomUUID()
  await db.insert(apiTokens).values({
    householdId: db.householdId,
    id,
    memberId: member.id,
    memberEmail: member.email,
    name,
    tokenHash: await hashToken(token),
    prefix: token.slice(0, SHOWN_CHARS),
    scopes,
    createdAt: now.toISOString(),
  })
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
