import { afterEach, describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import {
  DEMO_HOUSEHOLD_TABLES,
  createPersona,
  deleteDemoHousehold,
  resetPersona,
} from '@/lib/demo/service'
import { createHousehold } from '@/lib/households/service'
import { user } from '@/lib/db/schema'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const sqlite of open.splice(0)) sqlite.close()
})

const REAL = { id: 'real', email: 'rae@example.com', emailVerified: true }

/**
 * One row in every Household table besides memberships (made by creation),
 * from the table's own columns, so a new table is seeded without editing
 * this test.
 */
function seed(sqlite: DatabaseSync, householdId: string) {
  for (const table of DEMO_HOUSEHOLD_TABLES) {
    const name = getTableConfig(table).name
    if (name === 'household_members') continue
    const columns = (
      sqlite.prepare(`pragma table_info(\`${name}\`)`).all() as Array<{
        name: string
        type: string
        notnull: number
        dflt_value: string | null
        pk: number
      }>
    ).filter((c) => c.notnull || c.pk)
    const values = columns.map((c) =>
      c.name === 'household_id'
        ? householdId
        : c.type.toLowerCase() === 'integer'
          ? 1
          : `${name}-${c.name}-${householdId}`,
    )
    sqlite
      .prepare(
        `insert into \`${name}\` (${columns.map((c) => `\`${c.name}\``).join(', ')}) values (${columns.map(() => '?').join(', ')})`,
      )
      .run(...values)
  }
}

function counts(sqlite: DatabaseSync, householdId: string) {
  return Object.fromEntries(
    DEMO_HOUSEHOLD_TABLES.map((table) => {
      const name = getTableConfig(table).name
      const row = sqlite
        .prepare(`select count(*) as n from \`${name}\` where household_id = ?`)
        .get(householdId) as { n: number }
      return [name, row.n]
    }),
  )
}

async function twoHouseholds() {
  const { db, sqlite } = testDatabase()
  open.push(sqlite)
  await db.insert(user).values({ ...REAL, name: 'Rae' })
  const real = await createHousehold(db, REAL, 'Rae home', REAL.email)
  const sam = await createPersona(db, 'admin', 'Sam')
  const demo = await createHousehold(
    db,
    { id: sam.id, email: sam.email, emailVerified: true, demo: true },
    'Sam home',
    undefined,
  )
  seed(sqlite, real.id)
  seed(sqlite, demo.id)
  return { db, sqlite, real, demo, sam }
}

describe('resetting a Demo persona', () => {
  it('deletes every row of its Demo Household and nothing in another Household', async () => {
    const { db, sqlite, real, demo, sam } = await twoHouseholds()
    const realBefore = counts(sqlite, real.id)
    const demoBefore = counts(sqlite, demo.id)
    // Every table really had something to delete.
    expect(Object.values(demoBefore).every((n) => n > 0)).toBe(true)
    await resetPersona(db, 'admin', sam.id)
    expect(Object.values(counts(sqlite, demo.id)).every((n) => n === 0)).toBe(
      true,
    )
    expect(
      sqlite
        .prepare('select id from households')
        .all()
        .map((h) => h.id),
    ).toEqual(expect.not.arrayContaining([demo.id]))
    expect(counts(sqlite, real.id)).toEqual(realBefore)
  })

  it('refuses in SQL to delete a real Household, even by its id', async () => {
    const { db, sqlite, real } = await twoHouseholds()
    const before = counts(sqlite, real.id)
    await deleteDemoHousehold(db, real.id)
    expect(counts(sqlite, real.id)).toEqual(before)
    expect(
      sqlite.prepare('select id from households where id = ?').get(real.id),
    ).toBeTruthy()
  })

  it('frees its SimpleFIN connection for another Demo Household', async () => {
    const { db, sqlite, demo, sam } = await twoHouseholds()
    await resetPersona(db, 'admin', sam.id)
    const other = await createPersona(db, 'admin', 'Alex')
    const next = await createHousehold(
      db,
      { id: other.id, email: other.email, emailVerified: true, demo: true },
      'Alex home',
      undefined,
    )
    // The same access hash the reset Household held (bank_connections is
    // globally unique on it).
    sqlite
      .prepare(
        "insert into bank_connections (household_id, id, name, created_by, encrypted_access, access_hash, status) values (?, 'c2', 'Demo', 'x', 'x', ?, 'ready')",
      )
      .run(next.id, `bank_connections-access_hash-${demo.id}`)
    expect(
      sqlite.prepare('select count(*) as n from bank_connections').get(),
    ).toEqual({ n: 2 })
  })
})
