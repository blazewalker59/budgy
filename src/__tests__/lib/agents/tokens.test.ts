import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import {
  MAX_ACTIVE_TOKENS,
  bearerToken,
  createToken,
  hashToken,
  newToken,
  verifyToken,
} from '@/lib/agents/tokens'
import { householdDatabase } from '@/lib/households/scope'
import { apiTokens, householdMembers, households } from '@/lib/db/schema'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

describe('API tokens', () => {
  it('are long, random and URL-safe', () => {
    const a = newToken()
    expect(a).toMatch(/^bg_[A-Za-z0-9_-]{43}$/)
    expect(newToken()).not.toBe(a)
  })

  it('are stored as their SHA-256', async () => {
    expect(await hashToken('bg_abc')).toBe(await hashToken('bg_abc'))
    expect(await hashToken('bg_abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashToken('bg_abc')).not.toBe(await hashToken('bg_abd'))
  })

  it('come only from a Bearer header with our prefix', () => {
    expect(bearerToken('Bearer bg_abc')).toBe('bg_abc')
    expect(bearerToken('bearer   bg_abc')).toBe('bg_abc')
    expect(bearerToken('Bearer xyz')).toBeNull()
    expect(bearerToken('Basic bg_abc')).toBeNull()
    expect(bearerToken(null)).toBeNull()
  })

  it('are refused before the database when malformed', async () => {
    const { db, sqlite } = testDatabase()
    open.push(sqlite)
    expect(await verifyToken(db, 'bg_abc')).toBeNull()
  })

  it('stop at the limit per Member, even when requested all at once', async () => {
    const { db, sqlite, newClient } = testDatabase()
    open.push(sqlite)
    await db.insert(households).values({ id: 'a', name: 'A' })
    await db.insert(householdMembers).values([
      { householdId: 'a', memberId: 'alice', role: 'owner' },
      { householdId: 'a', memberId: 'bob', role: 'member' },
    ])
    const alice = { id: 'alice', email: 'alice@example.com' }
    const results = await Promise.allSettled(
      Array.from({ length: MAX_ACTIVE_TOKENS + 3 }, (_, i) =>
        createToken(householdDatabase(newClient(), 'a'), alice, `Agent ${i}`, [
          'read',
          'write',
        ]),
      ),
    )
    const made = results.filter((r) => r.status === 'fulfilled')
    expect(made).toHaveLength(MAX_ACTIVE_TOKENS)
    expect(
      results.find((r) => r.status === 'rejected')?.reason.message,
    ).toContain('revoke one')
    expect(await db.select().from(apiTokens)).toHaveLength(MAX_ACTIVE_TOKENS)

    // What the conditional insert stored reads back as a normal token.
    const first = made[0] as PromiseFulfilledResult<{ token: string }>
    expect(await verifyToken(db, first.value.token)).toMatchObject({
      householdId: 'a',
      memberId: 'alice',
      memberEmail: 'alice@example.com',
      scopes: ['read', 'write'],
    })
    // Another Member's allowance is their own.
    await createToken(
      householdDatabase(db, 'a'),
      {
        id: 'bob',
        email: 'bob@example.com',
      },
      'Bob’s agent',
    )
  })
})
