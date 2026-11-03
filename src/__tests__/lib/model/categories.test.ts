import { describe, expect, it } from 'vitest'
import { ledger as ledgerOf, txn } from '@test/factories'
import {
  categoryUseCount,
  pickableCategoryNames,
  renamedLedger,
} from '@/lib/model/categories'
import { indexLedger } from '@/lib/model/ledger'

describe('Hidden Categories', () => {
  it('leave pickers but still count where they’re used', () => {
    const l = ledgerOf({ txns: [txn({ sourceCategory: 'Kids' })] })
    const ix = indexLedger({
      ...l,
      categories: l.categories.map((c) =>
        c.name === 'Kids' || c.name === 'Tithe' ? { ...c, hidden: true } : c,
      ),
    })
    const names = pickableCategoryNames(ix)
    expect(names).not.toContain('Kids')
    expect(names).not.toContain('Tithe')
    expect(names).toContain('Groceries')
    expect(categoryUseCount(ix.ledger, 'Kids')).toBe(1)
    expect(categoryUseCount(ix.ledger, 'Tithe')).toBe(0)
  })
})

describe('Renaming in the browser’s Ledger', () => {
  it('matches the server: every row that names it', () => {
    const l = ledgerOf({
      txns: [txn({ sourceCategory: 'Food' }), txn({ category: 'Food' })],
      targets: [{ category: 'Food', startsMonth: '2026-10', amount: 1 }],
      rules: [
        { sourceCategory: '*', store: 'Aldi', category: 'Food', tag: null },
      ],
      dismissed: ['aldi|Food'],
      lenses: [{ id: 'l', name: 'x', lens: { categories: ['Food'] } }],
    })
    const next = renamedLedger(l, 'Food', 'Groceries')
    expect(next.txns.map((t) => [t.sourceCategory, t.category])).toEqual([
      ['Groceries', null],
      ['Groceries', 'Groceries'],
    ])
    expect(next.targets[0].category).toBe('Groceries')
    expect(next.rules[0].category).toBe('Groceries')
    expect(next.dismissed).toEqual(['aldi|Groceries'])
    expect(next.lenses[0].lens.categories).toEqual(['Groceries'])
  })
})
