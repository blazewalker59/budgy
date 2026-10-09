import { describe, expect, it } from 'vitest'
import { pay } from '@test/factories'
import { incomeSplit, percentOf, takeHome } from '@/lib/model/income'
import { addDays, monthRange } from '@/lib/model/dates'

const WINDOW = monthRange('2026-09', 3)
const TODAY = '2026-10-08'

/** A paycheck every `gap` days from `start` through September. */
function checks(start: string, gap: number, amount: number, payer = 'ACME') {
  const out = []
  for (let d = start; d <= '2026-09-30'; d = addDays(d, gap))
    out.push(pay({ date: d, amount, payer }))
  return out
}

describe('takeHome', () => {
  it('counts a biweekly check 26 times a year, not by calendar month', () => {
    const t = takeHome(checks('2026-07-03', 14, 200_000), WINDOW, '2026-10-05')
    expect(t.basis).toBe('paychecks')
    expect(t.sources[0]).toMatchObject({
      perYear: 26,
      perCheck: 200_000,
      ended: false,
    })
    expect(t.monthly).toBe(Math.round((200_000 * 26) / 12))
    // July had three checks; the typical month doesn't care.
    expect(t.received[0]).toBe(600_000)
  })

  it('adds up every employer and tells schedules apart', () => {
    const t = takeHome(
      [
        ...checks('2026-07-03', 14, 190_000, 'ROCKET'),
        ...checks('2026-07-01', 7, 50_000, 'WEEKLY'),
        ...['07', '08', '09'].map((m) =>
          pay({ date: `2026-${m}-15`, amount: 300_000, payer: 'MONTHLY' }),
        ),
      ],
      WINDOW,
      '2026-10-02',
    )
    // Biggest first.
    expect(t.sources.map((s) => [s.payer, s.perYear, s.monthly])).toEqual([
      ['ROCKET', 26, 411_667],
      ['MONTHLY', 12, 300_000],
      ['WEEKLY', 52, 216_667],
    ])
    expect(t.monthly).toBe(411_667 + 300_000 + 216_667)
  })

  it('treats a bonus and other deposits as Other income', () => {
    const t = takeHome(
      [
        ...checks('2026-07-03', 14, 200_000),
        pay({ date: '2026-08-20', amount: 1_000_000 }),
        pay({
          date: '2026-09-01',
          amount: 30_000,
          payer: 'Venmo',
          sourceCategory: 'Income',
        }),
      ],
      WINDOW,
      '2026-10-02',
    )
    expect(t.sources[0].perCheck).toBe(200_000)
    expect(t.other).toBe(Math.round(1_030_000 / 3))
  })

  it('leaves out an employer that stopped paying', () => {
    const t = takeHome(
      [
        ...checks('2026-07-03', 14, 200_000),
        ...checks('2026-07-01', 14, 90_000, 'OLD JOB').slice(0, 3),
      ],
      WINDOW,
      '2026-10-02',
    )
    const old = t.sources.find((s) => s.payer === 'OLD JOB')
    expect(old?.ended).toBe(true)
    expect(t.monthly).toBe(Math.round((200_000 * 26) / 12))
    expect(t.other).toBe(0)
  })

  it('falls back to averaging deposits without regular paychecks', () => {
    const t = takeHome(
      [pay({ date: '2026-08-01', amount: 90_000, sourceCategory: 'Income' })],
      WINDOW,
      TODAY,
    )
    expect(t).toMatchObject({ basis: 'deposits', monthly: 30_000, sources: [] })
    expect(takeHome([], WINDOW, TODAY)).toMatchObject({
      basis: 'none',
      monthly: 0,
    })
  })
})

describe('percentOf', () => {
  it('rounds to a whole percent, and has no answer without income', () => {
    expect(percentOf(1_234, 4_000)).toBe(31)
    expect(percentOf(5, 0)).toBeNull()
  })
})

describe('incomeSplit', () => {
  it('shows each part as a share of take-home, and what is left', () => {
    const s = incomeSplit(1_000_000, {
      everyday: 400_000,
      housing: 300_000,
      planned: 50_000,
    })
    expect(s.parts.map((p) => [p.part, p.share])).toEqual([
      ['everyday', 0.4],
      ['housing', 0.3],
      ['planned', 0.05],
    ])
    expect(s).toMatchObject({ spent: 750_000, left: 250_000, spentShare: 0.75 })
  })

  it('goes past 100% when spending outruns take-home', () => {
    const s = incomeSplit(100_000, {
      everyday: 90_000,
      housing: 30_000,
      planned: 0,
    })
    expect(s.left).toBe(-20_000)
    expect(s.spentShare).toBeCloseTo(1.2)
  })

  it('has no shares without income', () => {
    expect(
      incomeSplit(0, { everyday: 5, housing: 0, planned: 0 }).spentShare,
    ).toBe(0)
  })
})
