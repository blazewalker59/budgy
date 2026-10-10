import { describe, expect, it } from 'vitest'
import { ledger, plan, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { categoryHistory, monthView, upcoming } from '@/lib/model/month'
import { schedule } from '@/lib/model/plans'

describe('monthView', () => {
  const groceries = txn({ date: '2026-09-04', amount: 30_000 })
  const amazon = txn({
    date: '2026-09-05',
    store: 'Amazon',
    sourceCategory: 'Shopping',
    amount: 45_000,
  })
  const alexAmazon = txn({
    date: '2026-09-06',
    store: 'Amazon',
    sourceCategory: 'Shopping',
    amount: 5_000,
    account: 'Alex Apple Card',
  })
  const insurance = txn({
    date: '2026-09-02',
    store: 'Auto-Owners Insurance',
    sourceCategory: 'Insurance',
    amount: 121_000,
    account: 'Joint Checking (0001)',
  })
  const mortgage = txn({
    date: '2026-09-01',
    store: 'Homeloan Servicing',
    sourceCategory: 'Mortgage',
    amount: 260_000,
  })
  const l = ledger({
    txns: [groceries, amazon, alexAmazon, insurance, mortgage],
    plans: [plan({ anchor: '2026-03-03' })],
    targets: [
      { category: 'Groceries', startsMonth: '2026-01', amount: 40_000 },
      { category: 'Shopping', startsMonth: '2026-01', amount: 30_000 },
      { category: 'Pets', startsMonth: '2026-01', amount: 10_000 },
    ],
  })
  const ix = indexLedger(l)
  const occ = schedule(ix, '2026-01-01', '2027-12-31')

  it('keeps a planned bill out of everyday spending', () => {
    const v = monthView(ix, '2026-09', '2026-10-08', null, occ)
    const ins = v.everyday.find((r) => r.name === 'Insurance')!
    expect(ins.spent).toBe(0)
    expect(ins.plannedPaid).toBe(121_000)
    expect(v.totals.spent).toBe(80_000)
    expect(v.totals.plannedPaid).toBe(121_000)
  })

  it('counts a monthly bill in everyday spending, not as planned', () => {
    const gym = txn({
      date: '2026-09-20',
      store: 'Gym',
      sourceCategory: 'Kids',
      amount: 13_500,
    })
    const mix = indexLedger({
      ...l,
      txns: [...l.txns, gym],
      plans: [
        ...l.plans,
        plan({
          name: 'Gym',
          category: 'Kids',
          store: 'Gym',
          amount: 13_500,
          cadence: 'monthly',
          anchor: '2026-09-20',
        }),
      ],
    })
    const v = monthView(
      mix,
      '2026-09',
      '2026-10-08',
      null,
      schedule(mix, '2026-01-01', '2027-12-31'),
    )
    const kids = v.everyday.find((r) => r.name === 'Kids')!
    expect(kids.spent).toBe(13_500)
    expect(kids.planned).toEqual([])
    expect(v.totals.plannedPaid).toBe(121_000)
  })

  it('compares spending with Targets and lists empty targeted Categories', () => {
    const v = monthView(ix, '2026-09', '2026-10-08', null, occ)
    expect(v.totals.target).toBe(80_000)
    expect(v.everyday.find((r) => r.name === 'Pets')?.spent).toBe(0)
    expect(v.totals.flexibleSpent).toBe(50_000)
    expect(v.housing.map((r) => r.name)).toEqual(['Mortgage'])
    expect(v.elapsed).toBe(1)
  })

  it('ranks Stores by what they cost', () => {
    const v = monthView(ix, '2026-09', '2026-10-08', null, occ)
    expect(v.stores.map((s) => [s.store, s.amount])).toEqual([
      ['Amazon', 50_000],
      ['Kroger', 30_000],
    ])
  })

  it('narrows to one owner, without household Plans', () => {
    const v = monthView(ix, '2026-09', '2026-10-08', 'Alex', occ)
    expect(v.totals.spent).toBe(5_000)
    expect(v.totals.plannedLeft + v.totals.plannedPaid).toBe(0)
  })

  it('shows what is still to come in the current month', () => {
    const v = monthView(ix, '2027-03', '2027-03-01', null, occ)
    expect(v.totals.plannedLeft).toBe(120_000)
    expect(v.elapsed).toBeCloseTo(1 / 31)
  })
})

describe('upcoming', () => {
  it('lists unpaid due dates ahead, and recent ones not seen yet', () => {
    const ix = indexLedger(ledger({ plans: [plan({ anchor: '2026-10-01' })] }))
    const occ = schedule(ix, '2026-01-01', '2027-12-31')
    expect(upcoming(occ, '2026-10-08', '2027-01-08').map((o) => o.due)).toEqual(
      ['2026-10-01'],
    )
    expect(upcoming(occ, '2026-11-15', '2027-04-30').map((o) => o.due)).toEqual(
      ['2027-04-01'],
    )
  })
})

describe('categoryHistory', () => {
  it('averages per month with and without planned payments', () => {
    const a = txn({
      date: '2026-01-05',
      sourceCategory: 'Insurance',
      store: 'X',
      amount: 10_000,
    })
    const b = txn({
      date: '2026-02-05',
      sourceCategory: 'Insurance',
      store: 'X',
      amount: 110_000,
    })
    const ix = indexLedger(ledger({ txns: [a, b] }))
    const h = categoryHistory(ix, ['2026-01', '2026-02'], new Set([b.id])).get(
      'Insurance',
    )!
    expect(h).toEqual({
      monthly: [10_000, 0],
      allMonthly: [10_000, 110_000],
      typical: 5_000,
      withPlanned: 60_000,
      months: 2,
    })
  })

  it('averages a new Category only over the months since it started', () => {
    const old = txn({
      date: '2025-11-05',
      sourceCategory: 'Groceries',
      amount: 30_000,
    })
    const daycare = txn({
      date: '2026-02-03',
      sourceCategory: 'Childcare & education',
      store: 'Daycare',
      amount: 90_000,
    })
    const ix = indexLedger(ledger({ txns: [old, daycare] }))
    const window = ['2025-12', '2026-01', '2026-02']
    const h = categoryHistory(ix, window, new Set())
    expect(h.get('Childcare & education')?.typical).toBe(90_000)
    expect(h.get('Childcare & education')?.months).toBe(1)
    expect(h.has('Groceries')).toBe(false)
  })

  it('narrows to one owner', () => {
    const mine = txn({ date: '2026-01-05', amount: 4_000 })
    const hers = txn({
      date: '2026-01-06',
      amount: 6_000,
      account: 'Alex Apple Card',
    })
    const ix = indexLedger(ledger({ txns: [mine, hers] }))
    expect(
      categoryHistory(ix, ['2026-01'], new Set(), 'Alex').get('Groceries')
        ?.typical,
    ).toBe(6_000)
  })
})
