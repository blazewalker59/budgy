import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { createHousehold } from '@/lib/households/service'
import { householdOwners, householdTimeZone } from '@/lib/households/locale'
import { householdDatabase } from '@/lib/households/scope'
import { saveAccount } from '@/lib/ledger/accounts'
import { loadImportRules } from '@/lib/ledger/importer'
import { households, transactions } from '@/lib/db/schema'
import { EMPTY_RULES } from '@/lib/import/rules'
import { bucketCategory } from '@/lib/import/stores'
import { dateOn } from '@/lib/model/dates'
import { connectSimplefin, mapBankAccount } from '@/lib/updates/connections'
import { purchaseRow, syncConnection } from '@/lib/updates/sync'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

const actor = {
  id: 'sam',
  email: 'sam@example.com',
  emailVerified: true,
}
const card = {
  owner: 'Sam',
  kind: 'credit' as const,
  institution: null,
  closed: false,
  securedBy: null,
}
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const ACCESS = 'https://user:secret@beta-bridge.simplefin.org/simplefin'
const SETUP = btoa('https://beta-bridge.simplefin.org/simplefin/claim/demo')

/** A moment in the last two days that is a different date in these zones. */
function splitDay(): Date {
  const now = Date.now()
  for (let i = 0; i < 48; i++) {
    const at = new Date(now - i * 3_600_000)
    if (dateOn(at, 'America/New_York') !== dateOn(at, 'Pacific/Kiritimati'))
      return at
  }
  throw new Error('expected the two zones to disagree within two days')
}

describe('household time zone and owners', () => {
  it('keeps the original Household on New York, with its people and import rules', async () => {
    const { db, sqlite } = testDatabase()
    open.push(sqlite)
    const row = sqlite
      .prepare(
        `SELECT time_zone, owners FROM households WHERE id = 'hh_initial'`,
      )
      .get() as { time_zone: string; owners: string }
    expect(row).toEqual({
      time_zone: 'America/New_York',
      owners: '["Joint","Blaze","Alex"]',
    })
    const scope = householdDatabase(db, 'hh_initial')
    const rules = await loadImportRules(scope)
    const owners = await householdOwners(scope)
    expect(rules).toMatchObject({
      hardware: ["Lowe's", 'Home Depot', 'Ace Hardware'],
      upkeepExclude: 'golf',
      mortgageCategory: 'Mortgage and Utilities',
    })
    expect(owners).toEqual(['Joint', 'Blaze', 'Alex'])
    expect(bucketCategory('Shopping', "Lowe's #12", 'x', rules, owners)).toBe(
      'Home upkeep',
    )
    expect(
      bucketCategory('Entertainment', 'Home Depot golf', 'x', rules, owners),
    ).toBe('Entertainment')
    expect(
      bucketCategory('Mortgage and Utilities', 'Spectrum', 'x', rules, owners),
    ).toBe('Utilities & phones')
    expect(bucketCategory('Blaze', 'x', 'x', rules, owners)).toBe(
      'Blaze personal',
    )
    expect(bucketCategory('Sam', 'x', 'x', rules, owners)).toBe('Sam')
    expect(await householdTimeZone(scope)).toBe('America/New_York')
  })

  it('merges those rules into import rules the Household already saved', async () => {
    const { db, sqlite } = testDatabase((old) => {
      old.exec(
        `INSERT INTO settings (key, value) VALUES ('import_rules', '{"stores":[["Coffee","Cafe"]],"upkeep":"Local Plumber"}')`,
      )
    })
    open.push(sqlite)
    const rules = await loadImportRules(householdDatabase(db, 'hh_initial'))
    expect(rules.stores).toEqual([['Coffee', 'Cafe']])
    expect(rules.upkeep).toBe('Local Plumber')
    expect(rules.hardware).toEqual(["Lowe's", 'Home Depot', 'Ace Hardware'])
    expect(rules.upkeepExclude).toBe('golf')
    expect(rules.mortgageCategory).toBe('Mortgage and Utilities')
  })

  it('gives a new Household its own zone and owners, not the original ones', async () => {
    const { db, sqlite, newClient } = testDatabase()
    open.push(sqlite)
    const created = await createHousehold(db, actor, 'Friends')
    expect(created.timeZone).toBe('America/New_York')
    expect(created.owners).toEqual(['Joint'])
    const scope = householdDatabase(newClient(), created.id)
    expect(await loadImportRules(scope)).toEqual(EMPTY_RULES)
    expect(
      bucketCategory(
        'Shopping',
        "Lowe's #12",
        'x',
        EMPTY_RULES,
        created.owners,
      ),
    ).toBe('Shopping')
    expect(bucketCategory('Blaze', 'x', 'x', EMPTY_RULES, created.owners)).toBe(
      'Blaze',
    )

    await saveAccount(scope, { name: 'Card', ...card }, true)
    await db
      .update(households)
      .set({ timeZone: 'Asia/Tokyo', owners: JSON.stringify(['Joint', 'Sam']) })
      .where(eq(households.id, created.id))
    const owners = await householdOwners(scope)
    expect(owners).toEqual(expect.arrayContaining(['Joint', 'Sam']))
    expect(owners).not.toContain('Blaze')
    expect(owners).not.toContain('Alex')
    expect(bucketCategory('Sam', 'x', 'x', EMPTY_RULES, owners)).toBe(
      'Sam personal',
    )

    const at = new Date('2026-10-10T03:30:00Z')
    expect(dateOn(at, await householdTimeZone(scope))).toBe('2026-10-10')
    expect(
      dateOn(at, await householdTimeZone(householdDatabase(db, 'hh_initial'))),
    ).toBe('2026-10-09')
    expect(
      purchaseRow(
        {
          id: 't',
          posted: Math.floor(at.getTime() / 1000),
          transactedAt: null,
          amount: '-4.00',
          description: 'Cafe',
          pending: false,
        },
        true,
        await householdTimeZone(scope),
      ),
    ).toMatchObject({ date: '2026-10-10' })

    await db
      .update(households)
      .set({ timeZone: 'Not/AZone' })
      .where(eq(households.id, created.id))
    expect(await householdTimeZone(scope)).toBe('America/New_York')
  })

  it('files a synced purchase on that Household’s calendar day', async () => {
    const { db, sqlite, newClient } = testDatabase()
    open.push(sqlite)
    const created = await createHousehold(db, actor, 'Island')
    await db
      .update(households)
      .set({ timeZone: 'Pacific/Kiritimati' })
      .where(eq(households.id, created.id))
    const scope = householdDatabase(newClient(), created.id)
    await saveAccount(scope, { name: 'Card', ...card }, true)
    const at = splitDay()
    const posted = Math.floor(at.getTime() / 1000)
    const transport = ((url: string) =>
      Promise.resolve(
        url.includes('/claim/')
          ? new Response(ACCESS)
          : Response.json({
              errors: [],
              accounts: [
                {
                  id: 'ACT-1',
                  name: 'Sapphire',
                  org: { domain: 'chase.com', name: 'Chase' },
                  currency: 'USD',
                  balance: '-4.00',
                  transactions: [
                    {
                      id: 't1',
                      posted,
                      amount: '-4.00',
                      description: 'Cafe',
                    },
                  ],
                },
              ],
            }),
      )) as typeof fetch
    const { id } = await connectSimplefin(
      scope,
      actor,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      transport,
    )
    await mapBankAccount(scope, {
      connectionId: id,
      providerId: 'ACT-1',
      account: 'Card',
    })
    await syncConnection(scope, id, KEY, transport)
    const [row] = await db.select().from(transactions)
    expect(row.date).toBe(dateOn(at, 'Pacific/Kiritimati'))
    expect(row.date).not.toBe(dateOn(at, 'America/New_York'))
  })
})
