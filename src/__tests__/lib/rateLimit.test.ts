import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { overRateLimit } from '@/lib/rateLimit'
import { getAuth } from '@/lib/auth/server'
import { serveMcp } from '@/lib/agents/endpoint'
import { serveUpload } from '@/lib/updates/uploadEndpoint'
import { rateLimit } from '@/lib/db/schema'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

/** A Workers rate limiter allowing `max` calls per key. */
function limiter(max: number) {
  const seen = new Map<string, number>()
  const keys: Array<string> = []
  const binding: RateLimit = {
    limit({ key }) {
      keys.push(key)
      const count = (seen.get(key) ?? 0) + 1
      seen.set(key, count)
      return Promise.resolve({ success: count <= max })
    },
  }
  return { binding, keys }
}

const post = (path: string, authorization: string, ip = '203.0.113.7') =>
  new Request(`https://budgy.test${path}`, {
    method: 'POST',
    headers: { authorization, 'cf-connecting-ip': ip },
    body: '{}',
  })

describe('overRateLimit', () => {
  it('fails open without a binding, or when the binding fails', async () => {
    const request = post('/mcp', '')
    expect(await overRateLimit(undefined, request, null)).toBe(false)
    const broken: RateLimit = {
      limit: () => Promise.reject(new Error('unavailable')),
    }
    expect(await overRateLimit(broken, request, null)).toBe(false)
  })

  it('counts by IP and by token hash, never the raw token', async () => {
    const { binding, keys } = limiter(1)
    const token = `bg_${'a'.repeat(43)}`
    expect(await overRateLimit(binding, post('/mcp', ''), token)).toBe(false)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe('ip:203.0.113.7')
    expect(keys[1]).toMatch(/^token:[0-9a-f]{64}$/)
    expect(await overRateLimit(binding, post('/mcp', ''), token)).toBe(true)
  })
})

describe('token endpoints', () => {
  it('answer 429 once a caller is over the limit, before the database', async () => {
    const { binding } = limiter(0)
    // No DB at all: a limited request must not reach it.
    const env = {
      DB: undefined as unknown as D1Database,
      MCP_RATE_LIMITER: binding,
      UPLOAD_RATE_LIMITER: binding,
    }
    expect((await serveMcp(post('/mcp', 'Bearer x'), env)).status).toBe(429)
    expect(
      (await serveUpload(post('/api/updates/upload', 'Bearer x'), env)).status,
    ).toBe(429)
  })

  it('refuse a malformed MCP token without a database query', async () => {
    const env = { DB: undefined as unknown as D1Database }
    for (const header of ['Bearer bg_short', 'Bearer bg_' + 'a'.repeat(44)])
      expect((await serveMcp(post('/mcp', header), env)).status).toBe(401)
  })
})

describe('Better Auth rate limiting', () => {
  it('limits sign-in attempts per client IP, counted in D1', async () => {
    const { d1, db, sqlite } = testDatabase()
    open.push(sqlite)
    const auth = getAuth({
      DB: d1,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    })
    const attempt = (ip: string) =>
      auth.handler(
        new Request('http://localhost:3000/api/auth/sign-in/social', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'cf-connecting-ip': ip,
          },
          body: JSON.stringify({ provider: 'google' }),
        }),
      )
    const statuses = []
    for (let i = 0; i < 4; i++)
      statuses.push((await attempt('198.51.100.1')).status)
    expect(statuses.slice(0, 3)).not.toContain(429)
    expect(statuses[3]).toBe(429)
    expect((await attempt('198.51.100.2')).status).not.toBe(429)
    expect((await db.select().from(rateLimit)).length).toBeGreaterThan(0)
  })
})
