import { describe, expect, it } from 'vitest'
import { ledger, plan, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import {
  dueDates,
  monthlySetAside,
  planLines,
  plannedTxnIds,
  schedule,
} from '@/lib/model/plans'

describe('dueDates', () => {
  it('steps from the anchor in both directions', () => {
    const p = plan({ anchor: '2026-03-03', cadence: 'semiannual' })
    expect(dueDates(p, '2025-01-01', '2027-12-31')).toEqual([
      '2025-03-03',
      '2025-09-03',
      '2026-03-03',
      '2026-09-03',
      '2027-03-03',
      '2027-09-03',
    ])
  })

  it('keeps a month-end anchor from drifting', () => {
    const p = plan({ anchor: '2026-01-31', cadence: 'monthly' })
    expect(dueDates(p, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('has one date for a one-off', () => {
    const p = plan({ anchor: '2026-12-01', cadence: 'once' })
    expect(dueDates(p, '2026-01-01', '2026-12-31')).toEqual(['2026-12-01'])
    expect(dueDates(p, '2027-01-01', '2027-12-31')).toEqual([])
  })
})

describe('schedule', () => {
  const insurance = plan({ anchor: '2026-03-03' })
  const paidMarch = txn({
    date: '2026-03-05',
    store: 'Auto-Owners Insurance',
    sourceCategory: 'Insurance',
    amount: 121_000,
  })
  const smallFee = txn({
    date: '2026-09-01',
    store: 'Auto-Owners Insurance',
    sourceCategory: 'Insurance',
    amount: 500,
  })

  it('pairs each due date with the payment that made it', () => {
    const ix = indexLedger(
      ledger({ txns: [paidMarch, smallFee], plans: [insurance] }),
    )
    const occ = schedule(ix, '2026-01-01', '2026-12-31')
    expect(occ.map((o) => [o.due, o.paidBy?.id ?? null])).toEqual([
      ['2026-03-03', paidMarch.id],
      // A $5 fee from the same store is not the $1,200 bill.
      ['2026-09-03', null],
    ])
    expect(plannedTxnIds(occ)).toEqual(new Set([paidMarch.id]))
  })

  it('without a store, matches on amount within 10%', () => {
    const p = plan({
      store: null,
      amount: 60_000,
      cadence: 'annual',
      anchor: '2026-05-10',
    })
    const close = txn({
      date: '2026-05-12',
      store: 'County',
      sourceCategory: 'Insurance',
      amount: 63_000,
    })
    const far = txn({
      date: '2026-05-11',
      store: 'County',
      sourceCategory: 'Insurance',
      amount: 90_000,
    })
    const ix = indexLedger(ledger({ txns: [close, far], plans: [p] }))
    expect(schedule(ix, '2026-01-01', '2026-12-31')[0].paidBy?.id).toBe(
      close.id,
    )
  })

  it('ignores paused Plans', () => {
    const ix = indexLedger(ledger({ plans: [plan({ active: false })] }))
    expect(schedule(ix, '2026-01-01', '2026-12-31')).toEqual([])
  })

  it('spreads a Plan over its months', () => {
    expect(
      monthlySetAside(plan({ amount: 120_000, cadence: 'semiannual' })),
    ).toBe(20_000)
    expect(monthlySetAside(plan({ cadence: 'once' }))).toBe(0)
  })
})

describe('planLines', () => {
  const today = '2026-10-10'
  const lines = (plans: Array<ReturnType<typeof plan>>, txns = []) => {
    const ix = indexLedger(ledger({ plans, txns }))
    return planLines(plans, schedule(ix, '2026-01-01', '2027-12-31'), today)
  }

  it('puts each Plan once by when it’s next due: late, coming up, later, paused', () => {
    const out = lines([
      plan({ id: 'far', name: 'Far', anchor: '2027-04-01', cadence: 'annual' }),
      plan({
        id: 'late',
        name: 'Late',
        anchor: '2026-10-05',
        cadence: 'annual',
      }),
      plan({
        id: 'soon',
        name: 'Soon',
        anchor: '2026-11-01',
        cadence: 'annual',
      }),
      plan({
        id: 'off',
        name: 'Off',
        anchor: '2026-10-20',
        cadence: 'annual',
        active: false,
      }),
    ])
    expect(out.map((l) => [l.plan.id, l.status, l.next])).toEqual([
      ['late', 'late', '2026-10-05'],
      ['soon', 'soon', '2026-11-01'],
      ['far', 'later', '2027-04-01'],
      ['off', 'paused', null],
    ])
  })

  it('counts a monthly bill’s other due dates coming up', () => {
    const [l] = lines([
      plan({ id: 'm', anchor: '2026-10-15', cadence: 'monthly' }),
    ])
    expect(l).toMatchObject({ status: 'soon', next: '2026-10-15', more: 2 })
  })

  it('moves past a due date that’s paid, and remembers the payment', () => {
    const p = plan({
      id: 'ins',
      name: 'Insurance',
      category: 'Insurance',
      store: null,
      amount: 60_000,
      anchor: '2026-10-05',
      cadence: 'semiannual',
    })
    const paid = txn({
      date: '2026-10-04',
      amount: 60_000,
      sourceCategory: 'Insurance',
    })
    const [l] = lines([p], [paid] as never)
    expect(l).toMatchObject({ status: 'later', next: '2027-04-05' })
    expect(l.lastPaid?.id).toBe(paid.id)
  })
})
