import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { breakdown, inSelection, isSelecting } from '@/lib/model/breakdown'

const dining = (account: string, amount: number, date = '2026-09-05') =>
  txn({
    account,
    amount,
    date,
    store: 'Bistro',
    sourceCategory: 'Drinks & dining',
  })

describe('breakdown', () => {
  const blaze = dining('Blaze Apple Card', 30_000)
  const alex = dining('Alex Apple Card', 50_000)
  const augBlaze = dining('Blaze Apple Card', 10_000, '2026-08-05')
  const groceries = txn({ account: 'Joint Checking (0001)', amount: 70_000 })
  const insurance = txn({
    sourceCategory: 'Insurance',
    store: 'Insurer',
    amount: 120_000,
  })
  const mortgage = txn({
    sourceCategory: 'Mortgage',
    store: 'Lender',
    amount: 250_000,
  })
  const ix = indexLedger(
    ledger({
      txns: [blaze, alex, augBlaze, groceries, insurance, mortgage],
      targets: [
        { category: 'Drinks & dining', startsMonth: '2026-01', amount: 60_000 },
        { category: 'Groceries', startsMonth: '2026-01', amount: 80_000 },
        { category: 'Groceries', startsMonth: '2026-09', amount: 60_000 },
      ],
    }),
  )
  const planned = new Set([insurance.id])

  it('shows how one card adds up within each category and against Target', () => {
    const b = breakdown(
      ix,
      ['2026-09'],
      { accounts: ['Blaze Apple Card'] },
      planned,
    )
    const d = b.categories.find((c) => c.name === 'Drinks & dining')!
    expect(d).toMatchObject({ total: 80_000, selected: 30_000, target: 60_000 })
    expect(b.categories[0].name).toBe('Drinks & dining')
    expect(b.totals).toEqual({
      total: 150_000,
      selected: 30_000,
      target: 120_000,
      count: 1,
    })
  })

  it('leaves out housing and planned bills, as the Budget does', () => {
    const b = breakdown(ix, ['2026-09'], {}, planned)
    expect(b.categories.map((c) => c.name)).not.toContain('Mortgage')
    expect(b.categories.find((c) => c.name === 'Insurance')).toBeUndefined()
  })

  it('averages over several months, Targets included', () => {
    const b = breakdown(ix, ['2026-08', '2026-09'], { owner: 'Blaze' }, planned)
    const d = b.categories.find((c) => c.name === 'Drinks & dining')!
    expect(d.selected).toBe(20_000)
    expect(b.categories.find((c) => c.name === 'Groceries')?.target).toBe(
      70_000,
    )
    expect(b.months).toEqual([
      { month: '2026-08', total: 10_000, selected: 10_000 },
      { month: '2026-09', total: 150_000, selected: 30_000 },
    ])
  })

  it('lists a person’s sources and marks the selected ones', () => {
    const b = breakdown(ix, ['2026-09'], { owner: 'Alex' }, planned)
    expect(b.sources).toEqual([
      {
        account: 'Alex Apple Card',
        owner: 'Alex',
        amount: 50_000,
        selected: true,
      },
    ])
    const all = breakdown(
      ix,
      ['2026-09'],
      { accounts: ['Alex Apple Card'] },
      planned,
    )
    expect(all.sources.map((s) => [s.account, s.selected])).toEqual([
      ['Joint Checking (0001)', false],
      ['Alex Apple Card', true],
      ['Blaze Apple Card', false],
    ])
  })
})

describe('selection', () => {
  const ix = indexLedger(ledger())
  it('matches person, accounts and search together', () => {
    const t = txn({ store: 'Best Buy', note: 'thermostat' })
    expect(inSelection(ix, t, { owner: 'Blaze', q: 'THERMO' })).toBe(true)
    expect(inSelection(ix, t, { owner: 'Alex' })).toBe(false)
    expect(inSelection(ix, t, { accounts: ['Alex Apple Card'] })).toBe(false)
    expect(isSelecting({})).toBe(false)
    expect(isSelecting({ q: '  ' })).toBe(false)
    expect(isSelecting({ accounts: ['x'] })).toBe(true)
  })
})

describe('a Selection with its own test', () => {
  it('picks what the test picks', () => {
    const a = txn({ store: 'Kroger', amount: 5000 })
    const b = txn({ store: 'Target', amount: 3000 })
    const ix = indexLedger(ledger({ txns: [a, b] }))
    const sel = { match: (t: { store: string }) => t.store === 'Target' }
    expect(isSelecting(sel)).toBe(true)
    expect(inSelection(ix, a, sel)).toBe(false)
    expect(breakdown(ix, ['2026-09'], sel, new Set()).totals.selected).toBe(
      3000,
    )
  })
})
