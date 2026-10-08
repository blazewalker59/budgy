import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import {
  categoryOf,
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
