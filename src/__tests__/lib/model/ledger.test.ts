import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import {
  TRANSFER,
  allCategoryNames,
  categoryOf,
  everyTxn,
  indexLedger,
  ownerOf,
  storeCategory,
  tagOf,
  targetFor,
} from '@/lib/model/ledger'

describe('resolving a Transaction', () => {
  const chewy = txn({ store: 'Chewy', sourceCategory: 'Household' })
  const moved = txn({
    store: 'Chewy',
    sourceCategory: 'Household',
    category: 'Kids',
  })
  const ix = indexLedger(
    ledger({
      txns: [chewy, moved],
      rules: [
        {
          sourceCategory: 'Household',
          store: 'Chewy',
          category: 'Pets',
          tag: 'fluff',
        },
      ],
      targets: [
        { category: 'Groceries', startsMonth: '2025-01', amount: 150_000 },
        { category: 'Groceries', startsMonth: '2026-10', amount: 120_000 },
      ],
    }),
  )

  it('follows a Store Rule, and a Move wins over it', () => {
    expect(storeCategory(ix, chewy)).toBe('Pets')
    expect(categoryOf(ix, chewy)).toBe('Pets')
    expect(categoryOf(ix, moved)).toBe('Kids')
    expect(storeCategory(ix, moved)).toBe('Pets')
  })

  it('takes the Store Rule’s Tag unless Moved', () => {
    expect(tagOf(ix, chewy)).toBe('fluff')
    expect(tagOf(ix, moved)).toBe('nice')
  })

  it('finds the Target in force for a month', () => {
    expect(targetFor(ix, 'Groceries', '2024-12')).toBeNull()
    expect(targetFor(ix, 'Groceries', '2026-09')).toBe(150_000)
    expect(targetFor(ix, 'Groceries', '2026-10')).toBe(120_000)
    expect(targetFor(ix, 'Groceries', '2027-04')).toBe(120_000)
    expect(targetFor(ix, 'Pets', '2026-10')).toBeNull()
  })

  it('reads the owner from the Account, Joint when unknown', () => {
    expect(ownerOf(ix, chewy)).toBe('Blaze')
    expect(ownerOf(ix, txn({ account: 'Mystery card' }))).toBe('Joint')
  })
})

describe('Transfers', () => {
  const payment = txn({ store: 'NY 529 Plan', sourceCategory: 'Transfers' })
  const marked = txn({ store: 'Venmo', category: TRANSFER })
  const groceries = txn({ store: 'Kroger', sourceCategory: 'Groceries' })
  const ix = indexLedger(
    ledger({
      txns: [payment, marked, groceries],
      rules: [
        {
          sourceCategory: '*',
          store: 'NY 529 Plan',
          category: TRANSFER,
          tag: null,
        },
      ],
    }),
  )

  it('sets aside Transactions a Store Rule or a Move files as a Transfer', () => {
    expect(ix.ledger.txns).toEqual([groceries])
    expect(ix.transfers).toEqual([payment, marked])
    expect(everyTxn(ix)).toHaveLength(3)
  })

  it('never makes Transfer a Category', () => {
    expect(ix.categories.has(TRANSFER)).toBe(false)
    expect(allCategoryNames(ix)).not.toContain(TRANSFER)
  })

  it('leaves the Ledger alone when nothing is a Transfer', () => {
    const plain = ledger({ txns: [groceries] })
    const pix = indexLedger(plain)
    expect(pix.ledger).toBe(plain)
    expect(everyTxn(pix)).toBe(plain.txns)
  })
})
