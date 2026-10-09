import { describe, expect, it } from 'vitest'
import { parseBalanceHistory, readDate, readMoney } from '@/lib/import/history'

describe('readDate and readMoney', () => {
  it('reads the usual date shapes, and refuses impossible ones', () => {
    expect(readDate('2026-01-31')).toBe('2026-01-31')
    expect(readDate('2026/1/5')).toBe('2026-01-05')
    expect(readDate('1/31/2026')).toBe('2026-01-31')
    expect(readDate('1/31/26')).toBe('2026-01-31')
    expect(readDate('2/30/2026')).toBeNull()
    expect(readDate('Balance')).toBeNull()
  })

  it('reads dollars with signs, commas and parentheses', () => {
    expect(readMoney('$12,345.67')).toBe(1_234_567)
    expect(readMoney('(1,200.00)')).toBe(-120_000)
    expect(readMoney('-50')).toBe(-5000)
    expect(readMoney('n/a')).toBeNull()
  })
})

describe('parseBalanceHistory', () => {
  it('takes the column named like a balance from a CSV export', () => {
    const csv = [
      'Date,Contributions,Market Value,Note',
      '12/31/2025,"$1,000.00","$52,000.10",year end',
      '01/31/2026,"$1,000.00","$53,500.00",',
    ].join('\n')
    expect(parseBalanceHistory(csv)).toEqual({
      rows: [
        { date: '2025-12-31', amount: 5_200_010 },
        { date: '2026-01-31', amount: 5_350_000 },
      ],
      skipped: 0,
      column: 'Market Value',
    })
  })

  it('reads two columns pasted from a spreadsheet, without a header', () => {
    const pasted = '2026-02-28\t$10,000\n2026-01-31\t9,500.50\n\nnot a row\tx'
    const p = parseBalanceHistory(pasted)
    expect(p.rows).toEqual([
      { date: '2026-01-31', amount: 950_050 },
      { date: '2026-02-28', amount: 1_000_000 },
    ])
    expect(p).toMatchObject({ skipped: 1, column: null })
  })

  it('keeps one balance per day, the last given', () => {
    const p = parseBalanceHistory('2026-01-31,100\n2026-01-31,200')
    expect(p.rows).toEqual([{ date: '2026-01-31', amount: 20_000 }])
  })
})
