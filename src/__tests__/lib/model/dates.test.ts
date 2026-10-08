import { describe, expect, it } from 'vitest'
import {
  addMonths,
  daysBetween,
  lastDayOf,
  monthRange,
  monthsBetween,
  relativeDays,
  shiftMonth,
} from '@/lib/model/dates'

describe('dates', () => {
  it('adds months without running past month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15')
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
  })

  it('counts days and months', () => {
    expect(daysBetween('2026-09-01', '2026-09-22')).toBe(21)
    expect(daysBetween('2026-09-22', '2026-09-01')).toBe(-21)
    expect(monthsBetween('2025-11-30', '2026-02-01')).toBe(3)
  })

  it('lists month ranges', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthRange('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
    expect(lastDayOf('2026-02')).toBe('2026-02-28')
  })

  it('says how far away a date is', () => {
    expect(relativeDays('2026-10-08', '2026-10-08')).toBe('today')
    expect(relativeDays('2026-10-08', '2026-10-09')).toBe('tomorrow')
    expect(relativeDays('2026-10-08', '2026-10-13')).toBe('in 5 days')
    expect(relativeDays('2026-10-08', '2026-10-29')).toBe('in 3 weeks')
    expect(relativeDays('2026-10-08', '2026-10-04')).toBe('4 days ago')
  })
})
