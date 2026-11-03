import { afterEach, describe, expect, it, vi } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { sessionState } from '@/lib/auth/session'
import { serverRequestContext } from '@/lib/db'
import { householdMembers, households, user } from '@/lib/db/schema'

// The session comes from Better Auth's cookie handling, which needs a real
// OAuth sign-in; the test supplies the user it would return instead.
vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: {
      getSession: ({ headers }: { headers: Headers }) =>
        Promise.resolve({
          user: {
            id: 'alice',
            name: 'Alice',
            email: 'alice@example.com',
            emailVerified: headers.get('x-verified') === 'yes',
          },
        }),
    },
  }),
}))

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

async function stateFor(verified: boolean) {
  const { db, d1, sqlite } = testDatabase()
  open.push(sqlite)
  await db.insert(user).values({
    id: 'alice',
    name: 'Alice',
    email: 'alice@example.com',
    emailVerified: verified,
  })
  await db.insert(households).values({ id: 'a', name: 'A' })
  await db
    .insert(householdMembers)
    .values({ householdId: 'a', memberId: 'alice', role: 'owner' })
  return serverRequestContext.run(
    {
      headers: new Headers({ 'x-verified': verified ? 'yes' : 'no' }),
      env: { DB: d1, ALLOWED_EMAILS: 'alice@example.com' },
    },
    () => sessionState(),
  )
}

describe('sessionState', () => {
  it('admits a verified, allowlisted Member', async () => {
    expect((await stateFor(true)).status).toBe('member')
  })

  it('fails closed when Google has not verified the email', async () => {
    expect(await stateFor(false)).toEqual({
      status: 'not-allowed',
      email: 'alice@example.com',
    })
  })
})
