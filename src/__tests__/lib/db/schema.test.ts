import { describe, expect, it } from 'vitest'
import { is } from 'drizzle-orm'
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core'
import * as schema from '@/lib/db/schema'

/**
 * Tables that aren't a Household's: Better Auth's own, and the Households
 * themselves. Anything else must be scoped (docs/adr/0007); add here only
 * with a reason.
 */
const NOT_HOUSEHOLD_DATA = new Set([
  'user',
  'session',
  'account',
  'verification',
  'rate_limit',
  'households',
  // The demo sandbox's own bookkeeping (docs/adr/0015): who is a Demo
  // persona, which admin session acts as one, and what admins did. A
  // persona's Household is an ordinary (demo-flagged) Household.
  'demo_personas',
  'demo_sessions',
  'admin_audit',
])

const tables = Object.values(schema)
  .filter((value) => is(value, SQLiteTable))
  .map((table) => getTableConfig(table))

describe('the schema', () => {
  it('finds the tables', () => {
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['transactions', 'user', 'households']),
    )
  })

  it('gives every Ledger table a required household_id', () => {
    const unscoped = tables
      .filter((t) => !NOT_HOUSEHOLD_DATA.has(t.name))
      .filter(
        (t) => !t.columns.some((c) => c.name === 'household_id' && c.notNull),
      )
      .map((t) => t.name)
    expect(unscoped).toEqual([])
  })

  it('allowlists only tables that exist', () => {
    const names = new Set(tables.map((t) => t.name))
    for (const name of NOT_HOUSEHOLD_DATA) expect(names).toContain(name)
  })
})
