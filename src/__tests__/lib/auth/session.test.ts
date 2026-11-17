import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import type { CloudflareEnv, Database } from '@/lib/db'
import { sessionState, signedIn } from '@/lib/auth/session'
import { serverRequestContext } from '@/lib/db'
import { householdMembers, households, session, user } from '@/lib/db/schema'
import { LEGACY_HOUSEHOLD_ID } from '@/lib/households/membership'

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

describe('the local DEV_MEMBER_EMAIL sign-in', () => {
  async function devSignIn(seed?: (db: Database) => Promise<unknown>) {
    const { db, sqlite } = testDatabase()
    open.push(sqlite)
    // The first Household comes with the migrations.
    await seed?.(db)
    const result = await signedIn(
      { DEV_MEMBER_EMAIL: 'me@example.com' } as CloudflareEnv,
      db,
    )
    return { db, result }
  }

  it('makes a dev user, a Member of the first Household, with a session', async () => {
    const { db, result } = await devSignIn()
    expect(result).toMatchObject({ member: { id: 'dev' }, dev: true })
    const [made] = await db.select().from(user).where(eq(user.id, 'dev'))
    expect(made.email).toBe('me@example.com')
    const [s] = await db.select().from(session).where(eq(session.id, 'dev'))
    expect(s.userId).toBe('dev')
  })

  it('signs in as the user who already has that email (a copy of production)', async () => {
    const { db, result } = await devSignIn((d) =>
      d.insert(user).values({
        id: 'real',
        name: 'Me',
        email: 'me@example.com',
        emailVerified: true,
      }),
    )
    expect(result).toMatchObject({
      member: { id: 'real', name: 'Me', email: 'me@example.com' },
    })
    expect(await db.select().from(user)).toHaveLength(1)
    const [s] = await db.select().from(session).where(eq(session.id, 'dev'))
    expect(s.userId).toBe('real')
    const members = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.memberId, 'real'))
    expect(members.map((m) => m.householdId)).toEqual([LEGACY_HOUSEHOLD_ID])
  })
})
