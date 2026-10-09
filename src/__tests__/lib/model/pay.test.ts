import { describe, expect, it } from 'vitest'
import { paySchedule } from '@test/factories'
import {
  incomeSplit,
  monthlyPay,
  payByMonth,
  payInput,
  paydays,
  percentOf,
  takeHome,
} from '@/lib/model/pay'

describe('monthlyPay', () => {
  it('counts paychecks per year, not per calendar month', () => {
    expect(monthlyPay(paySchedule({ amount: 120_000 }))).toBe(260_000)
    expect(
      monthlyPay(paySchedule({ amount: 100_000, cadence: 'semimonthly' })),
    ).toBe(200_000)
    expect(monthlyPay(paySchedule({ amount: 10_000, cadence: 'weekly' }))).toBe(
      43_333,
    )
    expect(
      monthlyPay(paySchedule({ amount: 500_000, cadence: 'monthly' })),
    ).toBe(500_000)
  })
})

describe('paydays', () => {
  it('steps every 2 weeks from the payday given, either way', () => {
    const s = paySchedule({ anchor: '2026-09-04' })
    expect(paydays(s, '2026-08-01', '2026-09-30')).toEqual([
      '2026-08-07',
      '2026-08-21',
      '2026-09-04',
      '2026-09-18',
    ])
  })

  it('pays twice a month on both days, the last day included', () => {
    const s = paySchedule({
      cadence: 'semimonthly',
      anchor: '2026-01-15',
      secondDay: 31,
    })
    expect(paydays(s, '2026-02-01', '2026-03-20')).toEqual([
      '2026-02-15',
      '2026-02-28',
      '2026-03-15',
    ])
  })

  it('keeps a monthly payday inside short months', () => {
    const s = paySchedule({ cadence: 'monthly', anchor: '2026-01-31' })
    expect(paydays(s, '2026-02-01', '2026-04-30')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })
})

describe('takeHome', () => {
  it('adds every schedule, biggest first, with each next payday', () => {
    const t = takeHome(
      [
        paySchedule({ name: 'Alex', amount: 190_000, anchor: '2026-09-04' }),
        paySchedule({
          name: 'Blaze',
          amount: 430_000,
          anchor: '2026-09-09',
        }),
      ],
      '2026-10-08',
    )
    expect(t.monthly).toBe(411_667 + 931_667)
    expect(t.schedules.map((r) => [r.schedule.name, r.next])).toEqual([
      ['Blaze', '2026-10-21'],
      ['Alex', '2026-10-16'],
    ])
  })

  it('is nothing until pay is entered', () => {
    expect(takeHome([], '2026-10-08')).toEqual({ monthly: 0, schedules: [] })
  })
})

describe('payByMonth', () => {
  it('shows the month with a third biweekly paycheck', () => {
    const s = paySchedule({ amount: 100_000, anchor: '2026-01-02' })
    expect(payByMonth([s], ['2026-01', '2026-02'])).toEqual([300_000, 200_000])
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

describe('percentOf', () => {
  it('rounds to a whole percent, and has no answer without income', () => {
    expect(percentOf(1_234, 4_000)).toBe(31)
    expect(percentOf(5, 0)).toBeNull()
  })
})

describe('payInput', () => {
  it('keeps a second payday only for twice a month', () => {
    const base = paySchedule({ secondDay: 20 })
    expect(payInput.parse(base).secondDay).toBeNull()
    expect(
      payInput.parse({ ...base, cadence: 'semimonthly', secondDay: null })
        .secondDay,
    ).toBe(31)
  })

  it('refuses nonsense', () => {
    const base = paySchedule()
    expect(() => payInput.parse({ ...base, amount: 0 })).toThrow()
    expect(() => payInput.parse({ ...base, cadence: 'hourly' })).toThrow()
    expect(() => payInput.parse({ ...base, anchor: 'Friday' })).toThrow()
    expect(() => payInput.parse({ ...base, name: '  ' })).toThrow()
  })
})
