import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import { ANY_SOURCE, categoryOf, indexLedger } from '@/lib/model/ledger'
import { ruleUses, suggestRules } from '@/lib/model/rules'

describe('a store-wide rule', () => {
  const ix = indexLedger(
    ledger({
      txns: [
        txn({ id: 'a', store: 'Corner Shop', sourceCategory: 'Shopping' }),
        txn({ id: 'b', store: 'CORNER SHOP', sourceCategory: 'Uncategorized' }),
        txn({ id: 'c', store: 'Corner Shop', sourceCategory: 'Gifts' }),
        txn({
          id: 'd',
          store: 'Corner Shop',
          sourceCategory: 'Shopping',
          category: 'Hosting',
        }),
      ],
      rules: [
        {
          sourceCategory: ANY_SOURCE,
          store: 'Corner Shop',
          category: 'Groceries',
          tag: null,
        },
        {
          sourceCategory: 'Gifts',
          store: 'Corner Shop',
          category: 'Birthdays',
          tag: null,
        },
      ],
    }),
  )
  const cat = (id: string) =>
    categoryOf(
      ix,
      ix.ledger.txns.find((t) => t.id === id)!,
    )

  it('files the Store whatever it came in as, in any case', () => {
    expect(cat('a')).toBe('Groceries')
    expect(cat('b')).toBe('Groceries')
  })

  it('gives way to a rule for its own import Category, and to a Move', () => {
    expect(cat('c')).toBe('Birthdays')
    expect(cat('d')).toBe('Hosting')
  })

  it('counts what each rule files', () => {
    expect(
      ruleUses(ix).map((u) => [u.rule.sourceCategory, u.purchases]),
    ).toEqual([
      [ANY_SOURCE, 2],
      ['Gifts', 1],
    ])
  })
})

describe('suggestRules', () => {
  const store = (
    id: string,
    category: string | null,
    sourceCategory = 'Shopping',
  ) => txn({ id, store: 'Corner Shop', sourceCategory, category })

  it('suggests a rule for a Store Moved to one place again and again', () => {
    const ix = indexLedger(
      ledger({
        txns: [
          store('a', 'Groceries'),
          store('b', 'Groceries'),
          store('c', null),
          store('d', null, 'Groceries'),
          txn({ id: 'e', store: 'Elsewhere', category: 'Gifts' }),
        ],
      }),
    )
    expect(suggestRules(ix)).toEqual([
      {
        store: 'Corner Shop',
        category: 'Groceries',
        moved: 2,
        purchases: 4,
        changes: 1,
      },
    ])
  })

  it('stays quiet when the Moves disagree or a rule already files it there', () => {
    const split = indexLedger(
      ledger({
        txns: [
          store('a', 'Groceries'),
          store('b', 'Groceries'),
          store('c', 'Gifts'),
          store('d', 'Gifts'),
        ],
      }),
    )
    expect(suggestRules(split)).toEqual([])
    const ruled = indexLedger(
      ledger({
        txns: [store('a', 'Groceries'), store('b', 'Groceries')],
        rules: [
          {
            sourceCategory: ANY_SOURCE,
            store: 'corner shop',
            category: 'Groceries',
            tag: null,
          },
        ],
      }),
    )
    expect(suggestRules(ruled)).toEqual([])
  })
})
