import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import type { CloudflareEnv } from '@/lib/db'
import type { AdminAction } from '@/lib/demo/admin'
import { ADMIN_ACTIONS, runAdmin } from '@/lib/demo/admin'
import { requireMember, sessionState, withMember } from '@/lib/auth/session'
import { serverRequestContext } from '@/lib/db'
import {
  account,
  adminAudit,
  demoPersonas,
  demoSessions,
  householdMembers,
  households,
  session,
  user,
} from '@/lib/db/schema'
import {
  acceptInvite,
  createHousehold,
  createInvite,
  householdDetails,
  previewInvite,
} from '@/lib/households/service'
import { canSignIn } from '@/lib/households/admission'
import { saveSetup } from '@/lib/ledger/setup'
import { loadLedger } from '@/lib/ledger/queries'
import { saveAccount } from '@/lib/ledger/accounts'
import { createToken } from '@/lib/agents/tokens'

// Better Auth's session comes from a real OAuth cookie; the test says whose
// session this request carries instead.
const auth = vi.hoisted(() => ({
  current: null as null | {
    user: { id: string; name: string; email: string; emailVerified: boolean }
    session: { id: string }
  },
}))
vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: { getSession: () => Promise.resolve(auth.current) },
  }),
}))

const ADMIN = {
  id: 'admin',
  name: 'Ada',
  email: 'ada@example.com',
  emailVerified: true,
}
const REAL = {
  id: 'real',
  name: 'Rae',
  email: 'rae@example.com',
  emailVerified: true,
}
const ALLOWED = 'ada@example.com, rae@example.com'

const open: Array<DatabaseSync> = []
afterEach(() => {
  auth.current = null
  for (const sqlite of open.splice(0)) sqlite.close()
})

async function fixture() {
  const { db, d1, sqlite, newClient } = testDatabase()
  open.push(sqlite)
  for (const person of [ADMIN, REAL]) {
    await db.insert(user).values(person)
    await db.insert(session).values({
      id: `s_${person.id}`,
      token: `t_${person.id}`,
      userId: person.id,
      expiresAt: new Date('2100-01-01'),
      updatedAt: new Date(),
    })
  }
  // The admin and a real family each have a real Household.
  await createHousehold(db, ADMIN, 'Ada home', ALLOWED)
  const real = await createHousehold(db, REAL, 'Rae home', ALLOWED)
  let env: CloudflareEnv = {
    DB: d1,
    ALLOWED_EMAILS: ALLOWED,
    ADMIN_EMAILS: ADMIN.email,
  }
  const as = <T>(person: typeof ADMIN | null, fn: () => Promise<T>) => {
    auth.current = person && {
      user: person,
      session: { id: `s_${person.id}` },
    }
    return serverRequestContext.run({ headers: new Headers(), env }, fn)
  }
  const setEnv = (next: Partial<CloudflareEnv>) => {
    env = { ...env, ...next }
  }
  return { db, sqlite, newClient, real, as, setEnv }
}

/** What the database said when it refused (Drizzle wraps it as the cause). */
async function refusal(write: Promise<unknown>): Promise<string> {
  try {
    await write
  } catch (error) {
    const cause = (error as Error).cause
    return cause instanceof Error ? cause.message : String(error)
  }
  return 'not refused'
}

const SAMPLE_ID = `demo_${'0'.repeat(32)}`
const VALID: Record<AdminAction, unknown> = {
  personas: undefined,
  createPersona: { label: 'Sam' },
  actAs: { personaId: SAMPLE_ID },
  exitDemo: undefined,
  reset: { personaId: SAMPLE_ID },
  deletePersona: { personaId: SAMPLE_ID },
  replayInvite: { fromPersonaId: SAMPLE_ID, label: 'Alex' },
}

describe('admin actions', () => {
  it('deny every action to a non-admin, a signed-out visitor, and everyone when ADMIN_EMAILS is unset', async () => {
    const { as, setEnv, db } = await fixture()
    const actions = Object.keys(ADMIN_ACTIONS) as Array<AdminAction>
    expect(actions.sort()).toEqual(Object.keys(VALID).sort())
    for (const name of actions) {
      await expect(as(REAL, () => runAdmin(name, VALID[name]))).rejects.toThrow(
        'Page not found',
      )
      await expect(as(null, () => runAdmin(name, VALID[name]))).rejects.toThrow(
        'Page not found',
      )
    }
    setEnv({ ADMIN_EMAILS: undefined })
    for (const name of actions)
      await expect(
        as(ADMIN, () => runAdmin(name, VALID[name])),
      ).rejects.toThrow('Page not found')
    // An admin who isn't admitted (off ALLOWED_EMAILS) isn't an admin.
    setEnv({ ADMIN_EMAILS: ADMIN.email, ALLOWED_EMAILS: REAL.email })
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.memberId, ADMIN.id))
    await expect(
      as(ADMIN, () => runAdmin('personas', undefined)),
    ).rejects.toThrow('Page not found')
    expect(await db.select().from(demoPersonas)).toEqual([])
    expect(await db.select().from(adminAudit)).toEqual([])
  })

  it('are all a server function that does only runAdmin', () => {
    const source = readFileSync(resolve('src/lib/demo/server.ts'), 'utf8')
    const fns = source.match(/createServerFn\(/g) ?? []
    const runs = [...source.matchAll(/runAdmin\('(\w+)'/g)].map((m) => m[1])
    expect(fns.length).toBe(runs.length)
    expect(runs.sort()).toEqual(Object.keys(ADMIN_ACTIONS).sort())
  })

  it('validate their input with bounds', async () => {
    const { as } = await fixture()
    await expect(
      as(ADMIN, () => runAdmin('createPersona', { label: 'x'.repeat(31) })),
    ).rejects.toThrow()
    await expect(
      as(ADMIN, () => runAdmin('createPersona', { label: '<script>' })),
    ).rejects.toThrow()
    await expect(
      as(ADMIN, () => runAdmin('actAs', { personaId: 'real' })),
    ).rejects.toThrow()
    await expect(
      as(ADMIN, () => runAdmin('actAs', { personaId: SAMPLE_ID, extra: true })),
    ).rejects.toThrow()
  })
})

describe('acting as a Demo persona', () => {
  it('never lets an admin act as a real user', async () => {
    const { as, db } = await fixture()
    // Even a real user whose id looks like a persona's.
    await db.insert(user).values({
      id: SAMPLE_ID,
      name: 'Lookalike',
      email: 'lookalike@example.com',
      emailVerified: true,
    })
    await expect(
      as(ADMIN, () => runAdmin('actAs', { personaId: SAMPLE_ID })),
    ).rejects.toThrow('isn’t a demo persona')
    // And the database itself refuses to make them one.
    expect(
      await refusal(
        db
          .insert(demoPersonas)
          .values({ id: SAMPLE_ID, label: 'x', createdBy: ADMIN.id }),
      ),
    ).toContain('demo.invalid')
    expect(
      await refusal(
        db
          .insert(demoPersonas)
          .values({ id: REAL.id, label: 'x', createdBy: ADMIN.id }),
      ),
    ).toContain('demo.invalid')
    expect(await db.select().from(demoSessions)).toEqual([])
    const state = await as(ADMIN, () => sessionState())
    expect(state).toMatchObject({ status: 'member', member: { id: ADMIN.id } })
  })

  it('walks a persona through creation, setup, an invitation and joining on the Members’ own code paths', async () => {
    const { as, db } = await fixture()
    const sam = await as(ADMIN, () =>
      runAdmin('createPersona', { label: 'Sam' }),
    )
    expect(sam).toMatchObject({ name: 'Sam (demo)', label: 'Sam' })
    expect(sam.email).toMatch(/^sam-[a-z0-9]+@demo\.invalid$/)
    await as(ADMIN, () => runAdmin('actAs', { personaId: sam.id }))

    // Onboarding: the persona has no Household and makes one.
    const before = await as(ADMIN, () => sessionState())
    expect(before).toMatchObject({
      status: 'no-household',
      member: { id: sam.id, email: sam.email, demo: true },
      admin: true,
      demo: { persona: { id: sam.id }, admin: { email: ADMIN.email } },
    })
    const made = await as(ADMIN, async () =>
      createHousehold(db, await requireMember(), 'Sam home', ALLOWED, {
        timeZone: 'America/Chicago',
        people: ['Sam'],
      }),
    )
    const row = await db
      .select()
      .from(households)
      .where(eq(households.id, made.id))
      .get()
    expect(row?.demo).toBe(true)

    // Setup, through withMember like every server function.
    await as(ADMIN, () =>
      withMember(async ({ db: scoped }) => {
        await saveSetup(scoped, { step: 'categories', mark: 'done' })
        await saveAccount(
          scoped,
          {
            name: 'Card',
            owner: 'Sam',
            kind: 'credit',
            institution: null,
            closed: false,
            securedBy: null,
          },
          true,
        )
      }),
    )
    const personas = await as(ADMIN, () => runAdmin('personas', undefined))
    expect(personas).toHaveLength(1)
    expect(personas[0]).toMatchObject({
      acting: true,
      household: { name: 'Sam home', role: 'owner', accounts: 1 },
    })
    const steps = personas[0].household!.steps
    expect(steps.find((s) => s.id === 'household')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'categories')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'connect')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'partner')?.done).toBe(false)

    // Replay an invitation: a new persona, invited by Sam's Household.
    const { persona: alex, path } = await as(ADMIN, () =>
      runAdmin('replayInvite', { fromPersonaId: sam.id, label: 'Alex' }),
    )
    expect(path).toMatch(/^\/join\/[A-Za-z0-9_-]{43}$/)
    const token = path.slice('/join/'.length)

    // The admin switches to Alex, who previews and accepts.
    await as(ADMIN, () => runAdmin('actAs', { personaId: alex.id }))
    const preview = await as(ADMIN, async () =>
      previewInvite(db, await requireMember(), token),
    )
    expect(preview.name).toBe('Sam home')
    await as(ADMIN, async () => acceptInvite(db, await requireMember(), token))
    const joined = await as(ADMIN, () => sessionState())
    expect(joined).toMatchObject({
      status: 'member',
      member: { id: alex.id },
      household: { id: made.id, role: 'member' },
    })
    const details = await as(ADMIN, () =>
      withMember(({ db: scoped, member }) => householdDetails(scoped, member)),
    )
    expect(details.members.map((m) => m.name).sort()).toEqual([
      'Alex (demo)',
      'Sam (demo)',
    ])

    // Resetting Alex takes them out; Sam's Household stays.
    await as(ADMIN, () => runAdmin('reset', { personaId: alex.id }))
    expect(await as(ADMIN, () => sessionState())).toMatchObject({
      status: 'no-household',
      member: { id: alex.id },
    })
    // Exiting goes back to the admin's own Household.
    await as(ADMIN, () => runAdmin('exitDemo', undefined))
    expect(await as(ADMIN, () => sessionState())).toMatchObject({
      status: 'member',
      member: { id: ADMIN.id },
      household: { name: 'Ada home' },
    })
    expect((await db.select().from(adminAudit)).map((a) => a.action)).toEqual([
      'create persona',
      'act as',
      'create persona',
      'replay invite',
      'act as',
      'reset persona',
      'exit demo',
    ])
  })

  it('ends as soon as the admin leaves ADMIN_EMAILS, and for good', async () => {
    const { as, db, setEnv } = await fixture()
    const sam = await as(ADMIN, () =>
      runAdmin('createPersona', { label: 'Sam' }),
    )
    await as(ADMIN, () => runAdmin('actAs', { personaId: sam.id }))
    expect((await as(ADMIN, () => sessionState())).status).toBe('no-household')
    setEnv({ ADMIN_EMAILS: 'someone@example.com' })
    const after = await as(ADMIN, () => sessionState())
    expect(after).toMatchObject({ status: 'member', member: { id: ADMIN.id } })
    expect(after).not.toHaveProperty('demo')
    expect(await db.select().from(demoSessions)).toEqual([])
    setEnv({ ADMIN_EMAILS: ADMIN.email })
    expect(await as(ADMIN, () => sessionState())).toMatchObject({
      member: { id: ADMIN.id },
    })
  })

  it('ends when the admin signs out', async () => {
    const { as, db } = await fixture()
    const sam = await as(ADMIN, () =>
      runAdmin('createPersona', { label: 'Sam' }),
    )
    await as(ADMIN, () => runAdmin('actAs', { personaId: sam.id }))
    expect(await db.select().from(demoSessions)).toHaveLength(1)
    // Better Auth's sign-out deletes the session row.
    await db.delete(session).where(eq(session.id, `s_${ADMIN.id}`))
    expect(await db.select().from(demoSessions)).toEqual([])
  })

  it('is bound to the admin’s session, not to anyone else’s', async () => {
    const { as, db } = await fixture()
    const sam = await as(ADMIN, () =>
      runAdmin('createPersona', { label: 'Sam' }),
    )
    // A row naming another user's session (never written by Budgy) is ignored.
    await db.insert(demoSessions).values({
      sessionId: `s_${REAL.id}`,
      adminId: ADMIN.id,
      personaId: sam.id,
    })
    expect(await as(REAL, () => sessionState())).toMatchObject({
      member: { id: REAL.id },
    })
  })
})

describe('Demo personas', () => {
  it('can never sign in: no Google account, no admission without a demo session', async () => {
    const { as, db } = await fixture()
    const sam = await as(ADMIN, () =>
      runAdmin('createPersona', { label: 'Sam' }),
    )
    expect(
      await refusal(
        db.insert(account).values({
          id: 'acct',
          accountId: 'google-1',
          providerId: 'google',
          userId: sam.id,
          updatedAt: new Date(),
        }),
      ),
    ).toContain('cannot sign in')
    expect(await canSignIn(db, sam.email, sam.email)).toBe(false)
    expect(
      await canSignIn(db, sam.email, undefined, new Date(), {
        demoSession: true,
      }),
    ).toBe(true)
    // Its email can't be moved to a real address, nor a real one to demo.
    expect(
      await refusal(
        db
          .update(user)
          .set({ email: 'sam@example.com' })
          .where(eq(user.id, sam.id)),
      ),
    ).toContain('demo.invalid')
    expect(
      await refusal(
        db
          .update(user)
          .set({ email: 'rae@demo.invalid' })
          .where(eq(user.id, REAL.id)),
      ),
    ).toContain('demo.invalid')
  })

  it('make Agent tokens that never work, even inside their Household', async () => {
    const { as, db } = await fixture()
    const sam = await as(ADMIN, () =>
      runAdmin('createPersona', { label: 'Sam' }),
    )
    await as(ADMIN, () => runAdmin('actAs', { personaId: sam.id }))
    await as(ADMIN, async () =>
      createHousehold(db, await requireMember(), 'Sam home', ALLOWED),
    )
    await as(ADMIN, () =>
      withMember(({ db: scoped, member }) =>
        createToken(scoped, member, 'Claude', ['read']),
      ),
    )
    // The MCP and Shortcut endpoints admit a token's maker with canSignIn.
    expect(await canSignIn(db, sam.email, ALLOWED)).toBe(false)
  })

  it('can’t start a Household, or join a real one, without an admin’s demo session', async () => {
    const { db, real, newClient } = await fixture()
    const persona = { id: 'p', email: 'p-1@demo.invalid', emailVerified: true }
    await db.insert(user).values({ ...persona, name: 'P (demo)' })
    await expect(
      createHousehold(db, persona, 'P', persona.email),
    ).rejects.toThrow('invitation-only')
    // A real owner can't invite a demo address, nor a demo one a real person.
    const { requireHousehold } = await import('@/lib/households/membership')
    const scope = await requireHousehold(newClient(), REAL.id, real.id)
    await expect(
      createInvite(scope, { ...REAL, emailVerified: true }, persona.email),
    ).rejects.toThrow('valid email')
  })
})

describe('a Demo Household', () => {
  it('invites only Demo personas', async () => {
    const { as, db } = await fixture()
    const sam = await as(ADMIN, () =>
      runAdmin('createPersona', { label: 'Sam' }),
    )
    await as(ADMIN, () => runAdmin('actAs', { personaId: sam.id }))
    await as(ADMIN, async () =>
      createHousehold(db, await requireMember(), 'Sam home', ALLOWED),
    )
    await expect(
      as(ADMIN, () =>
        withMember(({ db: scoped, member }) =>
          createInvite(scoped, member, REAL.email),
        ),
      ),
    ).rejects.toThrow('only invite a demo persona')
    // And the database won't seat a real user in it.
    const demo = await db
      .select()
      .from(households)
      .where(eq(households.demo, true))
      .get()
    expect(
      await refusal(
        db.insert(householdMembers).values({
          householdId: demo!.id,
          memberId: 'someone',
          role: 'member',
        }),
      ),
    ).toContain('Only Demo personas')
    expect(
      await refusal(
        db
          .update(households)
          .set({ demo: false })
          .where(eq(households.id, demo!.id)),
      ),
    ).toContain('Demo Household')
  })

  it('is deleted with every one of its rows by Delete persona, and the admin’s and real Households are untouched', async () => {
    const { as, db, real, newClient } = await fixture()
    const sam = await as(ADMIN, () =>
      runAdmin('createPersona', { label: 'Sam' }),
    )
    await as(ADMIN, () => runAdmin('actAs', { personaId: sam.id }))
    await as(ADMIN, async () =>
      createHousehold(db, await requireMember(), 'Sam home', ALLOWED),
    )
    await as(ADMIN, () => runAdmin('deletePersona', { personaId: sam.id }))
    expect(await db.select().from(demoPersonas)).toEqual([])
    expect(await db.select().from(demoSessions)).toEqual([])
    expect(await db.select().from(user).where(eq(user.id, sam.id))).toEqual([])
    expect(
      await db.select().from(households).where(eq(households.demo, true)),
    ).toEqual([])
    const { requireHousehold } = await import('@/lib/households/membership')
    const ledger = await loadLedger(
      await requireHousehold(newClient(), REAL.id, real.id),
    )
    expect(ledger.categories.length).toBeGreaterThan(10)
    expect(await as(ADMIN, () => sessionState())).toMatchObject({
      member: { id: ADMIN.id },
    })
  })
})

describe('DEMO_HOUSEHOLD_TABLES', () => {
  it('is the schema’s every table with a household_id', async () => {
    const { DEMO_HOUSEHOLD_TABLES } = await import('@/lib/demo/service')
    const { sqlite } = await fixture()
    const tables = (
      sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_cf\\_%' escape '\\'",
        )
        .all() as Array<{ name: string }>
    )
      .map((t) => t.name)
      .filter((name) =>
        (
          sqlite.prepare(`pragma table_info(\`${name}\`)`).all() as Array<{
            name: string
          }>
        ).some((c) => c.name === 'household_id'),
      )
    expect(
      DEMO_HOUSEHOLD_TABLES.map((t) => getTableConfig(t).name).sort(),
    ).toEqual(tables.sort())
  })
})
