import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { D1_MAX_VARIABLES, rowsPerInsert } from '@/lib/ledger/importer'
import { balances, transactions } from '@/lib/db/schema'

// Only builds SQL; nothing is sent, so no database is needed.
const db = drizzle({} as D1Database)

describe('rowsPerInsert', () => {
  it('keeps a full insert of purchases within D1’s variable limit', () => {
    const n = rowsPerInsert(transactions)
    const row = {
      householdId: 'hh_test',
      id: 'abc',
      date: '2026-10-07',
      month: '2026-10',
      account: 'Card',
      description: 'Coffee',
      store: 'Coffee',
      sourceCategory: 'Drinks & dining',
      amount: 500,
      category: 'Hosting',
      note: 'carried over',
      importId: 'im_1',
    }
    const { params } = db
      .insert(transactions)
      .values(Array.from({ length: n }, (_, i) => ({ ...row, id: `t${i}` })))
      .onConflictDoNothing()
      .toSQL()
    expect(params.length).toBeLessThanOrEqual(D1_MAX_VARIABLES)
    expect(n).toBeGreaterThan(1)
  })

  it('keeps a full insert of balances within it too', () => {
    const n = rowsPerInsert(balances)
    const { params } = db
      .insert(balances)
      .values(
        Array.from({ length: n }, (_, i) => ({
          householdId: 'hh_test',
          account: 'Card',
          date: `2026-01-${String(i + 1).padStart(2, '0')}`,
          amount: 100,
          recordedBy: 'a@example.com',
        })),
      )
      .toSQL()
    expect(params.length).toBeLessThanOrEqual(D1_MAX_VARIABLES)
  })
})
