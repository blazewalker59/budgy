import { describe, expect, it } from 'vitest'
import { ledger, plan, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import {
  dueDates,
  monthlySetAside,
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
