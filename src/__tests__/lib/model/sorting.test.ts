import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { unsortedShare, unsortedStores } from '@/lib/model/sorting'

describe('Spending to sort', () => {
  it('lists Uncategorized Stores, the most spent first, any case as one', () => {
    const ix = indexLedger(
      ledger({
        txns: [
          txn({ store: 'Gym', sourceCategory: 'Uncategorized', amount: 3000 }),
          txn({
            store: 'Cafe',
            sourceCategory: 'Uncategorized',
            amount: 500,
            date: '2026-09-02',
          }),
          txn({
            store: 'CAFE',
            sourceCategory: 'Uncategorized',
            amount: 700,
            date: '2026-09-20',
          }),
          // Moved, or filed by a Store Rule: already sorted.
          txn({
            store: 'Moved',
            sourceCategory: 'Uncategorized',
            category: 'Groceries',
          }),
          txn({ store: 'Ruled', sourceCategory: 'Uncategorized' }),
          txn({ store: 'Kroger', sourceCategory: 'Groceries' }),
        ],
        rules: [
          {
            sourceCategory: '*',
            store: 'ruled',
            category: 'Shopping',
            tag: null,
          },
        ],
      }),
    )
    expect(unsortedStores(ix)).toEqual([
      { store: 'Gym', purchases: 1, spent: 3000, last: '2026-09-10' },
      { store: 'Cafe', purchases: 2, spent: 1200, last: '2026-09-20' },
    ])
    expect(unsortedShare(ix)).toEqual({ unsorted: 3, purchases: 6 })
  })
})
