import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { authBase, getAuth } from '@/lib/auth/server'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

describe('getAuth', () => {
  it('never links a Google identity to an existing user', () => {
    const { d1, sqlite } = testDatabase()
    open.push(sqlite)
    const auth = getAuth({
      DB: d1,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    })
    expect(auth.options.account?.accountLinking).toEqual({ enabled: false })
  })

  it('refuses Google sign-in for a demo.invalid email, even an allowlisted one', async () => {
    const { d1, sqlite } = testDatabase()
    open.push(sqlite)
    const auth = getAuth({
      DB: d1,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      ALLOWED_EMAILS: 'sam-1@demo.invalid, sam@example.com',
    })
    const before = auth.options.databaseHooks?.user?.create?.before
    const attempt = (email: string) =>
      before!({
        id: 'u',
        email,
        name: 'Sam',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    expect(await attempt('sam-1@demo.invalid')).toBe(false)
    expect(await attempt('SAM-1@Demo.Invalid')).toBe(false)
    expect(await attempt('sam@example.com')).toBe(true)
  })

  it('uses secure cookies when Budgy is served over HTTPS', () => {
    const { d1, sqlite } = testDatabase()
    open.push(sqlite)
    const auth = getAuth({
      DB: d1,
      BETTER_AUTH_URL: 'https://budgy.bid',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    })
    expect(auth.options.advanced?.useSecureCookies).toBe(true)
  })
})

describe('authBase', () => {
  const DB = undefined as unknown as D1Database
  it('refuses to run a deployment without its URL or secret', () => {
    expect(() => authBase({ DB }, false)).toThrow('must both be set')
    expect(() =>
      authBase({ DB, BETTER_AUTH_URL: 'https://budgy.bid' }, false),
    ).toThrow('must both be set')
    expect(() => authBase({ DB, BETTER_AUTH_SECRET: 's' }, false)).toThrow(
      'must both be set',
    )
    expect(
      authBase(
        { DB, BETTER_AUTH_URL: 'https://budgy.bid', BETTER_AUTH_SECRET: 's' },
        false,
      ),
    ).toEqual({
      baseURL: 'https://budgy.bid',
      secret: 's',
      useSecureCookies: true,
    })
  })

  it('lets local development and tests run without them, over plain HTTP', () => {
    expect(authBase({ DB }, true).useSecureCookies).toBe(false)
    expect(
      authBase({ DB, BETTER_AUTH_URL: 'http://localhost:3000' }, true)
        .useSecureCookies,
    ).toBe(false)
  })
})
