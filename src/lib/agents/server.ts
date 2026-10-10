/**
 * A Member's API tokens for Agents (docs/adr/0004): list, create (the token
 * is shown once) and revoke.
 */

import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { createToken } from './tokens'
import { apiTokens } from '@/lib/db/schema'
import { withMember } from '@/lib/auth/session'
import { inHousehold } from '@/lib/households/scope'

/** Enough for a few Agents; more is likely tokens nobody revoked. */
const MAX_ACTIVE_TOKENS = 10

export interface ApiTokenRow {
  id: string
  name: string
  prefix: string
  scopes: Array<string>
  createdAt: string
  lastUsedAt: string | null
}

/** Your tokens that still work, newest first. */
export const getApiTokens = createServerFn({ method: 'GET' }).handler(() =>
  withMember(({ db, member }): Promise<Array<ApiTokenRow>> =>
    db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        prefix: apiTokens.prefix,
        scopes: apiTokens.scopes,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
      })
      .from(apiTokens)
      .where(
        and(
          inHousehold(db, apiTokens),
          eq(apiTokens.memberId, member.id),
          isNull(apiTokens.revokedAt),
        ),
      )
      .orderBy(desc(apiTokens.createdAt)),
  ),
)

/** A new token, returned this once and never again. */
export const createApiToken = createServerFn({ method: 'POST' })
  .validator((data: { name: string; write?: boolean }) =>
    z
      .object({
        name: z.string().trim().min(1).max(60),
        write: z.boolean().default(false),
      })
      .parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db, member }) => {
      const active = await db
        .select({ id: apiTokens.id })
        .from(apiTokens)
        .where(
          and(
            inHousehold(db, apiTokens),
            eq(apiTokens.memberId, member.id),
            isNull(apiTokens.revokedAt),
          ),
        )
      if (active.length >= MAX_ACTIVE_TOKENS) {
        throw new Error(
          `You have ${MAX_ACTIVE_TOKENS} tokens: revoke one to make another`,
        )
      }
      return createToken(
        db,
        member,
        data.name,
        data.write ? ['read', 'write'] : ['read'],
      )
    }),
  )

/** Stop a token working, at once. */
export const revokeApiToken = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) =>
    z.object({ id: z.string().min(1).max(64) }).parse(data),
  )
  .handler(({ data }) =>
    withMember(async ({ db, member }) => {
      await db
        .update(apiTokens)
        .set({ revokedAt: new Date().toISOString() })
        .where(
          and(
            inHousehold(db, apiTokens),
            eq(apiTokens.id, data.id),
            eq(apiTokens.memberId, member.id),
          ),
        )
    }),
  )
