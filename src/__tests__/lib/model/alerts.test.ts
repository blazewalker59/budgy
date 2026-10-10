import { describe, expect, it } from 'vitest'
import { ledger, plan, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { schedule } from '@/lib/model/plans'
import { budgetAlerts } from '@/lib/model/alerts'
import { dailyDigest } from '@/lib/model/digest'

const TARGETS = [
  { category: 'Drinks & dining', startsMonth: '2026-01', amount: 40_000 },
  { category: 'Groceries', startsMonth: '2026-01', amount: 100_000 },
  { category: 'Shopping', startsMonth: '2026-01', amount: 100_000 },
]

function alertsFor(txns: Parameters<typeof ledger>[0], today: string) {
  const ix = indexLedger(ledger({ targets: TARGETS, ...txns }))
  const occ = schedule(ix, '2026-01-01', '2027-12-31')
  return budgetAlerts(ix, today, occ)
}

describe('budgetAlerts', () => {
  it('flags a category over its Target, most urgent first', () => {
    const alerts = alertsFor(
      {
        txns: [
          txn({
            date: '2026-10-03',
            store: 'Bistro',
            sourceCategory: 'Drinks & dining',
            amount: 45_000,
          }),
        ],
      },
      '2026-10-08',
    )
    expect(alerts[0]).toMatchObject({
      kind: 'over-target',
      severity: 'high',
      category: 'Drinks & dining',
      amount: 5_000,
    })
  })

  it('keeps a small overage at medium', () => {
    const alerts = alertsFor(
      {
        txns: [
          txn({
            date: '2026-10-03',
            store: 'Bistro',
            sourceCategory: 'Drinks & dining',
            amount: 40_500,
          }),
        ],
      },
      '2026-10-08',
    )
    expect(alerts.find((a) => a.kind === 'over-target')?.severity).toBe(
      'medium',
    )
  })

  it('warns when a category is on pace to go over, but not on day two', () => {
    const txns = ['02', '05', '09'].map((d) =>
      txn({ date: `2026-10-${d}`, amount: 20_000 }),
    )
    expect(
      alertsFor({ txns }, '2026-10-12').find((a) => a.kind === 'on-pace-over'),
    ).toMatchObject({ category: 'Groceries' })
    expect(
      alertsFor({ txns }, '2026-10-09').some((a) => a.kind === 'on-pace-over'),
    ).toBe(false)
    // One big early purchase waits for mid-month.
    const vet = [txn({ date: '2026-10-02', amount: 60_000 })]
    expect(
      alertsFor({ txns: vet }, '2026-10-12').some(
        (a) => a.kind === 'on-pace-over',
      ),
    ).toBe(false)
  })

  it('gives notice of a planned bill, and says when one is late', () => {
    const due = alertsFor(
      { plans: [plan({ anchor: '2026-10-20' })] },
      '2026-10-08',
    )
    expect(due.find((a) => a.kind === 'bill-due')).toMatchObject({
      severity: 'info',
      amount: 120_000,
    })
    const late = alertsFor(
      { plans: [plan({ anchor: '2026-10-01' })] },
      '2026-10-08',
    )
    expect(late.find((a) => a.kind === 'bill-late')?.severity).toBe('high')
  })

  it('mentions a large purchase from the last week, but not a planned one', () => {
    const tv = txn({
      date: '2026-10-06',
      store: 'Best Buy',
      sourceCategory: 'Shopping',
      amount: 64_900,
    })
    const paid = txn({
      date: '2026-10-05',
      store: 'Auto-Owners Insurance',
      sourceCategory: 'Insurance',
      amount: 120_000,
    })
    const alerts = alertsFor(
      { txns: [tv, paid], plans: [plan({ anchor: '2026-10-04' })] },
      '2026-10-08',
    )
    const large = alerts.filter((a) => a.kind === 'large-purchase')
    expect(large.map((a) => a.amount)).toEqual([64_900])
  })
})

describe('dailyDigest', () => {
  it('lists one day across accounts, by person and account, in dollars', () => {
    const ix = indexLedger(
      ledger({
        targets: TARGETS,
        txns: [
          txn({ date: '2026-10-07', store: 'Kroger', amount: 8_412 }),
          txn({
            date: '2026-10-07',
            store: 'Bistro',
            sourceCategory: 'Drinks & dining',
            amount: 5_500,
            account: 'Alex Apple Card',
          }),
          txn({
            date: '2026-10-07',
            store: 'Refund',
            sourceCategory: 'Shopping',
            amount: -1_000,
          }),
          txn({ date: '2026-10-06', store: 'Kroger', amount: 2_000 }),
        ],
      }),
    )
    const d = dailyDigest(ix, '2026-10-07', '2026-10-08', [], new Set())
    expect(d.count).toBe(3)
    expect(d.total).toBe(129.12)
    expect(d.byOwner).toEqual([
      { owner: 'Blaze', total: 74.12, count: 2 },
      { owner: 'Alex', total: 55, count: 1 },
    ])
    expect(d.transactions[0]).toMatchObject({
      store: 'Kroger',
      amount: 84.12,
      category: 'Groceries',
      owner: 'Blaze',
    })
    expect(d.monthToDate).toEqual({
      spent: 149.12,
      target: 2400,
      plannedLeft: 0,
    })
    expect(d.freshness).toEqual([
      { account: 'Alex Apple Card', latest: '2026-10-07' },
      { account: 'Blaze Apple Card', latest: '2026-10-07' },
    ])
  })
})
