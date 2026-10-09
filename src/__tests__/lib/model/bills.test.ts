import { describe, expect, it } from 'vitest'
import { ledger, paySchedule, plan, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { monthView } from '@/lib/model/month'
import { plannedTxnIds, schedule } from '@/lib/model/plans'
import { monthBills, monthPay, usualHousing } from '@/lib/model/bills'

// Utilities post around the 20th every month; the mortgage on the 1st.
const history = [
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
]
const utilities = history.map((m) =>
  txn({
    date: `${m}-20`,
    store: 'Power Co',
    sourceCategory: 'Utilities & phones',
    amount: 20_000,
  }),
)
const mortgages = [...history, '2026-10'].map((m) =>
  txn({
    date: `${m}-01`,
    store: 'Homeloan Servicing',
    sourceCategory: 'Mortgage',
    amount: 260_000,
  }),
)
const l = ledger({
  txns: [...utilities, ...mortgages],
  plans: [plan({ name: 'Car insurance', anchor: '2026-04-20' })],
})
const ix = indexLedger(l)
const occ = schedule(ix, '2026-01-01', '2027-12-31')
const plannedIds = plannedTxnIds(occ)

describe('monthBills', () => {
  const view = monthView(ix, '2026-10', '2026-10-09', null, occ)

  it('lists what’s paid, then what’s due and what usually comes', () => {
    const b = monthBills(ix, view, '2026-10-09', plannedIds)
    expect(b.lines).toEqual([
      { name: 'Mortgage', amount: 260_000, date: '2026-10-01', status: 'paid' },
      {
        name: 'Car insurance',
        amount: 120_000,
        date: '2026-10-20',
        status: 'due',
      },
      {
        name: 'Utilities & phones',
        amount: 20_000,
        date: '2026-10-20',
        status: 'usual',
      },
    ])
    expect(b.paid).toBe(260_000)
    expect(b.expected).toBe(400_000)
  })

  it('puts what’s still to come on the line of a bill partly paid', () => {
    const part = txn({
      date: '2026-10-03',
      store: 'Water Co',
      sourceCategory: 'Utilities & phones',
      amount: 4_000,
    })
    const ix2 = indexLedger({ ...l, txns: [...l.txns, part] })
    const v = monthView(ix2, '2026-10', '2026-10-09', null, occ)
    const b = monthBills(ix2, v, '2026-10-09', plannedIds)
    expect(b.lines.filter((x) => x.name === 'Utilities & phones')).toEqual([
      {
        name: 'Utilities & phones',
        amount: 4_000,
        date: '2026-10-03',
        status: 'paid',
        more: { amount: 16_000, date: '2026-10-20' },
      },
    ])
    expect(b.expected - b.paid).toBe(16_000 + 120_000)
  })

  it('leaves out what usually comes once the month is over, or under a Lens', () => {
    expect(
      monthBills(ix, view, '2026-11-02', plannedIds).lines.map((x) => x.status),
    ).toEqual(['paid', 'due'])
    expect(
      monthBills(ix, view, '2026-10-09', plannedIds, false).lines.map(
        (x) => x.name,
      ),
    ).toEqual(['Mortgage', 'Car insurance'])
  })
})

describe('usualHousing', () => {
  it('finds Housing that posts most months, and the day it lands', () => {
    expect(usualHousing(ix, '2026-10', plannedIds)).toEqual(
      expect.arrayContaining([
        { name: 'Utilities & phones', typical: 20_000, day: 20 },
        { name: 'Mortgage', typical: 260_000, day: 1 },
      ]),
    )
  })

  it('leaves out Housing that swings month to month, like upkeep', () => {
    const upkeep = history.map((m, i) =>
      txn({
        date: `${m}-10`,
        store: 'Hardware',
        sourceCategory: 'Home upkeep',
        amount: i % 2 ? 2_000 : 90_000,
      }),
    )
    const ix2 = indexLedger({ ...l, txns: [...l.txns, ...upkeep] })
    expect(
      usualHousing(ix2, '2026-10', plannedIds).map((u) => u.name),
    ).not.toContain('Home upkeep')
  })

  it('needs four of the last six months', () => {
    expect(usualHousing(ix, '2026-07', plannedIds)).toEqual([])
  })
})

describe('monthPay', () => {
  it('counts the paychecks that land in the month, and the next payday', () => {
    // Every two weeks from Sep 4: Oct 2, 16 and 30.
    const p = monthPay([paySchedule()], '2026-10', '2026-10-09')
    expect(p).toEqual({ amount: 600_000, paychecks: 3, next: '2026-10-16' })
  })
})
