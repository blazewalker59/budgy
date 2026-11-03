import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import {
  acceptInvite,
  createHousehold,
  createInvite,
  updateHouseholdSettings,
} from '@/lib/households/service'
import {
  cleanOwners,
  deviceTimeZone,
  firstName,
  isTimeZone,
  zoneLabel,
} from '@/lib/households/basics'
import {
  findMemberHousehold,
  requireHousehold,
} from '@/lib/households/membership'
import { households, user } from '@/lib/db/schema'

const owner = { id: 'owner', email: 'owner@example.com', emailVerified: true }
const partner = {
  id: 'partner',
  email: 'partner@example.com',
  emailVerified: true,
}
const other = { id: 'other', email: 'other@example.com', emailVerified: true }
/** Creators on ALLOWED_EMAILS. */
const CREATORS = 'owner@example.com,other@example.com'
const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const sqlite of open.splice(0)) sqlite.close()
})

async function fixture() {
  const { db, sqlite, newClient } = testDatabase()
  open.push(sqlite)
  await db
    .insert(user)
    .values([owner, partner, other].map((p) => ({ ...p, name: p.id })))
  const ours = await createHousehold(db, owner, 'Ours', CREATORS, {
    timeZone: 'America/Chicago',
    people: ['Sam', ' Riley '],
  })
  const theirs = await createHousehold(db, other, 'Theirs', CREATORS)
  return { db, newClient, ours, theirs }
}

describe('Household basics', () => {
  it('cleans the people a Member typed, with Joint always first', () => {
    expect(cleanOwners(['Sam', ' sam ', '', 'joint', 'Riley  Ann'])).toEqual([
      'Joint',
      'Sam',
      'Riley Ann',
    ])
    expect(() => cleanOwners(['x'.repeat(41)])).toThrow(/40 characters/)
    expect(() =>
      cleanOwners(Array.from({ length: 13 }, (_, i) => `P${i}`)),
    ).toThrow(/12 people/)
  })

  it('accepts only zones Intl lists', () => {
    expect(isTimeZone('America/Chicago')).toBe(true)
    expect(isTimeZone('UTC')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone('')).toBe(false)
    expect(isTimeZone(deviceTimeZone('America/New_York'))).toBe(true)
    expect(zoneLabel('America/New_York')).toBe('New York (America)')
    expect(firstName('Sam Lee')).toBe('Sam')
    expect(firstName(null)).toBe('')
  })
})

describe('Creating a Household with its basics', () => {
  it('keeps the chosen time zone and people', async () => {
    const { db, ours } = await fixture()
    expect(ours).toMatchObject({
      timeZone: 'America/Chicago',
      owners: ['Joint', 'Sam', 'Riley'],
    })
    expect(await findMemberHousehold(db, owner.id)).toMatchObject({
      timeZone: 'America/Chicago',
      owners: ['Joint', 'Sam', 'Riley'],
    })
  })

  it('falls back to the defaults when none are given', async () => {
    const { theirs } = await fixture()
    expect(theirs).toMatchObject({
      timeZone: 'America/New_York',
      owners: ['Joint'],
    })
  })

  it('refuses a zone that isn’t real, creating nothing', async () => {
    const { db, sqlite } = testDatabase()
    open.push(sqlite)
    await db.insert(user).values({ ...owner, name: 'owner' })
    await expect(
      createHousehold(db, owner, 'Ours', CREATORS, {
        timeZone: 'Nowhere/Land',
      }),
    ).rejects.toThrow('Choose a time zone from the list')
    expect(await findMemberHousehold(db, owner.id)).toBeNull()
    expect(
      (await db.select().from(households)).filter((h) => h.name === 'Ours'),
    ).toEqual([])
  })
})

describe('Changing Household settings', () => {
  it('lets any Member change the name, time zone and people', async () => {
    const { db, newClient, ours } = await fixture()
    const ownerScope = await requireHousehold(newClient(), owner.id, ours.id)
    const invite = await createInvite(ownerScope, owner, partner.email)
    await acceptInvite(db, partner, invite.token)
    const scope = await requireHousehold(newClient(), partner.id, ours.id)
    await expect(
      updateHouseholdSettings(scope, partner, {
        name: ' Our house ',
        timeZone: 'Europe/London',
        people: ['Sam'],
      }),
    ).resolves.toEqual({
      name: 'Our house',
      timeZone: 'Europe/London',
      owners: ['Joint', 'Sam'],
    })
    expect(await findMemberHousehold(db, owner.id)).toMatchObject({
      name: 'Our house',
      timeZone: 'Europe/London',
      owners: ['Joint', 'Sam'],
    })
  })

  it('rejects a bad zone or name and leaves the settings as they were', async () => {
    const { db, newClient, ours } = await fixture()
    const scope = await requireHousehold(newClient(), owner.id, ours.id)
    await expect(
      updateHouseholdSettings(scope, owner, {
        name: 'Ours',
        timeZone: 'Atlantis/Deep',
        people: [],
      }),
    ).rejects.toThrow('Choose a time zone from the list')
    await expect(
      updateHouseholdSettings(scope, owner, {
        name: '  ',
        timeZone: 'UTC',
        people: [],
      }),
    ).rejects.toThrow('Name your Household')
    expect(await findMemberHousehold(db, owner.id)).toMatchObject({
      name: 'Ours',
      timeZone: 'America/Chicago',
    })
  })

  it('never changes another Household', async () => {
    const { db, newClient, ours, theirs } = await fixture()
    // A scope bound to another Household is refused for this Member.
    await expect(
      requireHousehold(newClient(), owner.id, theirs.id),
    ).rejects.toThrow('Household access denied')
    // Their own scope, with someone else's identity, changes nothing.
    const scope = await requireHousehold(newClient(), owner.id, ours.id)
    await expect(
      updateHouseholdSettings(scope, other, {
        name: 'Hijacked',
        timeZone: 'UTC',
        people: [],
      }),
    ).rejects.toThrow('Household access denied')
    const rows = await db
      .select({ name: households.name })
      .from(households)
      .where(eq(households.id, theirs.id))
    expect(rows).toEqual([{ name: 'Theirs' }])
    expect((await findMemberHousehold(db, owner.id))?.name).toBe('Ours')
  })
})
