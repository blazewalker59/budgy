import { describe, expect, it } from 'vitest'
import { ledger, plan, txn } from '@test/factories'
import { TRANSFER, indexLedger } from '@/lib/model/ledger'
import { suggestPlans } from '@/lib/model/detect'
import { forecast } from '@/lib/model/forecast'
import { schedule } from '@/lib/model/plans'
import { coverageGaps } from '@/lib/model/coverage'

const ins = (date: string, amount = 121_000) =>
  txn({
    date,
    store: 'Auto-Owners Insurance',
    sourceCategory: 'Insurance',
    amount,
  })

describe('suggestPlans', () => {
  it('spots a twice-a-year bill and says when it is next due', () => {
    const ix = indexLedger(
      ledger({
        txns: [ins('2025-03-04'), ins('2025-09-03'), ins('2026-03-05')],
      }),
    )
    const [s] = suggestPlans(ix, '2026-10-08')
    expect(s.cadence).toBe('semiannual')
    expect(s.category).toBe('Insurance')
    // Sep 5 has passed without a charge being imported; next is March.
    expect(s.nextDue).toBe('2027-03-05')
  })

  it('ignores irregular, small or already planned charges', () => {
    const irregular = indexLedger(
      ledger({ txns: [ins('2025-01-04'), ins('2025-03-01')] }),
    )
    expect(suggestPlans(irregular, '2026-10-08')).toEqual([])
    const dining = indexLedger(
      ledger({
        txns: [
          txn({
            date: '2025-05-17',
            store: 'Riverside Grill',
            sourceCategory: 'Drinks & dining',
            amount: 25_400,
          }),
          txn({
            date: '2026-05-17',
            store: 'Riverside Grill',
            sourceCategory: 'Drinks & dining',
            amount: 41_900,
          }),
        ],
      }),
    )
    expect(suggestPlans(dining, '2026-10-08')).toEqual([])
    const small = indexLedger(
      ledger({ txns: [ins('2025-03-04', 900), ins('2025-09-03', 900)] }),
    )
    expect(suggestPlans(small, '2026-10-08')).toEqual([])
    const planned = indexLedger(
      ledger({ txns: [ins('2025-03-04'), ins('2025-09-03')], plans: [plan()] }),
    )
    expect(suggestPlans(planned, '2026-10-08')).toEqual([])
  })
})

describe('forecast', () => {
  it('adds planned bills to the months they fall in', () => {
    const ix = indexLedger(
      ledger({
        plans: [plan({ anchor: '2027-03-03' })],
        targets: [
          { category: 'Groceries', startsMonth: '2026-01', amount: 200_000 },
          { category: 'Mortgage', startsMonth: '2026-01', amount: 260_000 },
        ],
      }),
    )
    const months = forecast(
      ix,
      '2027-02',
      2,
      schedule(ix, '2027-01-01', '2027-12-31'),
    )
    expect(
      months.map((m) => [m.month, m.everyday, m.housing, m.planned]),
    ).toEqual([
      ['2027-02', 200_000, 260_000, 0],
      ['2027-03', 200_000, 260_000, 120_000],
    ])
  })
})

describe('coverageGaps', () => {
  it('flags an Account that went quiet before the month ended', () => {
    const l = ledger({
      txns: [
        ...['06-03', '06-20', '07-02', '07-15', '07-30', '08-04'].map((d) =>
          txn({ date: `2026-${d}`, account: 'Alex Apple Card' }),
        ),
        ...['06-03', '07-02', '08-01', '09-28'].map((d) =>
          txn({ date: `2026-${d}`, account: 'Blaze Apple Card' }),
        ),
        // Rarely used: one purchase in the summer isn't a gap.
        txn({ date: '2026-06-30', account: 'Joint Checking (0001)' }),
      ],
    })
    expect(coverageGaps(indexLedger(l), '2026-09', '2026-10-08')).toEqual([
      { account: 'Alex Apple Card', last: '2026-08-04' },
    ])
  })

  it('counts Transfers as an Account still coming in', () => {
    const l = ledger({
      txns: [
        ...['06-03', '06-20', '07-02', '07-15', '07-30', '08-04'].map((d) =>
          txn({ date: `2026-${d}`, account: 'Joint Checking' }),
        ),
        // Its only September activity: a payment into a 529.
        txn({
          date: '2026-09-25',
          account: 'Joint Checking',
          category: TRANSFER,
        }),
      ],
    })
    expect(coverageGaps(indexLedger(l), '2026-09', '2026-10-08')).toEqual([])
  })
})
