import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { monthView } from '@/lib/model/month'
import { dailySpend, monthPace, spendLevels } from '@/lib/model/pace'

describe('monthPace', () => {
  const ix = indexLedger(
    ledger({
      txns: [
        txn({ date: '2026-11-02', amount: 10_000 }),
        txn({ date: '2026-11-10', amount: 5_000 }),
        txn({ date: '2026-11-20', amount: 7_000 }),
        // Earlier months: October early, September late.
        txn({ date: '2026-10-01', amount: 20_000 }),
        txn({ date: '2026-09-30', amount: 40_000 }),
        // Housing isn't everyday spending.
        txn({
          date: '2026-11-01',
          store: 'Homeloan Servicing',
          sourceCategory: 'Mortgage',
          amount: 260_000,
        }),
      ],
      targets: [
        { category: 'Groceries', startsMonth: '2026-01', amount: 30_000 },
      ],
    }),
  )
  const view = (month: string, today = '2026-11-16') =>
    monthView(ix, month, today, null, [])

  it('adds up everyday spending day by day', () => {
    const daily = dailySpend(view('2026-11'))
    expect(daily).toHaveLength(30)
    expect(daily[1]).toBe(10_000)
    expect(daily[0]).toBe(0)
    const pace = monthPace(ix, view('2026-11'), '2026-11-16', [])
    expect(pace.total[9]).toBe(15_000)
    expect(pace.total[29]).toBe(22_000)
  })

  it('counts by today against the Budget’s even pace', () => {
    const pace = monthPace(ix, view('2026-11'), '2026-11-16', [])
    expect(pace.today).toBe(15)
    expect(pace.spent).toBe(15_000)
    expect(pace.target).toBe(30_000)
    // Even pace by the 16th of 30 days: $160.
    expect(pace.overPace).toBe(-1_000)
  })

  it('finds the usual from earlier months with spending, stretched to fit', () => {
    const pace = monthPace(ix, view('2026-11'), '2026-11-16', [])
    expect(pace.months).toBe(2)
    // By the 16th: October had spent $200, September nothing yet.
    expect(pace.usual?.[15]).toEqual({ low: 0, median: 20_000, high: 20_000 })
    expect(pace.vsUsual).toBe(-5_000)
    // By month end both had: $200 and $400.
    expect(pace.usual?.[29]).toEqual({
      low: 20_000,
      median: 40_000,
      high: 40_000,
    })
  })

  it('runs to the end of a past month and not at all in a future one', () => {
    const october = monthPace(ix, view('2026-10'), '2026-11-16', [])
    expect(october.today).toBe(30)
    expect(october.spent).toBe(20_000)

    const december = monthPace(ix, view('2026-12'), '2026-11-16', [])
    expect(december.today).toBe(-1)
    expect(december.spent).toBe(0)
    expect(december.overPace).toBe(0)
    expect(december.vsUsual).toBeNull()
  })

  it('has no usual without earlier spending', () => {
    const pace = monthPace(ix, view('2026-09'), '2026-11-16', [])
    expect(pace.usual).toBeNull()
    expect(pace.months).toBe(0)
    expect(pace.vsUsual).toBeNull()
  })
})

describe('spendLevels', () => {
  it('steps days by rank, so each step holds about as many', () => {
    expect(
      spendLevels([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 0]),
    ).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0])
  })

  it('ranks rather than measures, so one huge day doesn’t wash out the rest', () => {
    expect(spendLevels([10, 20, 30, 10_000])).toEqual([1, 2, 4, 5])
  })

  it('gives equal amounts one step, and a lone day the top', () => {
    expect(spendLevels([50, 50, 50])).toEqual([1, 1, 1])
    expect(spendLevels([0, 75, 0])).toEqual([0, 5, 0])
    expect(spendLevels([])).toEqual([])
  })
})
