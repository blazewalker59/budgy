import { describe, expect, it } from 'vitest'
import {
  EXPORT_TOO_LARGE,
  MAX_EXPORT_BYTES,
  detectExport,
  normalizeExport,
  withinExportLimit,
} from '@/lib/updates/exports'

const header =
  'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)'
describe('Account export conventions', () => {
  it('detects Apple Card but never guesses a generic amount sign', () => {
    expect(detectExport(header)).toBe('apple-card')
    expect(detectExport('Date,Description,Amount')).toBeNull()
    expect(detectExport('Date,Description,Debit,Credit')).toBe('debit-credit')
  })

  it('normalizes Apple purchases and credits, excludes payments, and prefers the Merchant name', () => {
    const result = normalizeExport(
      `${header}\n10/01/2026,10/02/2026,COFFEE SHOP 123,Coffee Shop,Dining,Purchase,5.00\n10/03/2026,10/03/2026,Refund,Coffee Shop,Dining,Credit,2.00\n10/04/2026,10/04/2026,Card payment,,Other,Payment,-100`,
      'apple-card',
      true,
    )
    expect(result.rows).toEqual([
      {
        date: '2026-10-01',
        description: 'Coffee Shop',
        amount: 5,
        category: 'Dining',
      },
      {
        date: '2026-10-03',
        description: 'Coffee Shop',
        amount: -2,
        category: 'Dining',
      },
    ])
    expect(result).toMatchObject({
      excluded: 1,
      fromDate: '2026-10-01',
      toDate: '2026-10-04',
      total: 3,
    })
  })

  it('does not guess from a refunds-only export', () => {
    expect(
      normalizeExport(
        `${header}\n10/01/2026,10/02/2026,Store refund,Shop,Other,Credit,-5`,
        'apple-card',
        true,
      ).rows[0].amount,
    ).toBe(-5)
    expect(
      normalizeExport(
        'Date,Description,Amount\n2026-10-01,Store refund,5',
        'money-out-negative',
        false,
      ).rows[0].amount,
    ).toBe(-5)
  })

  it('handles bank exports without keeping deposits, transfers or both debit and credit', () => {
    const result = normalizeExport(
      'Date,Description,Debit,Credit\n2026-10-01,Grocer,5,\n2026-10-02,Store refund,,2\n2026-10-03,Payroll,,100\n2026-10-04,Transfer to savings,10,',
      'debit-credit',
      false,
    )
    expect(result.rows.map((r) => r.amount)).toEqual([5, -2])
    expect(result.excluded).toBe(2)
    expect(() =>
      normalizeExport(
        'Date,Description,Debit,Credit\n2026-10-01,Shop,5,2',
        'debit-credit',
        false,
      ),
    ).toThrow('Nothing was imported')
  })

  it('accepts payment-only exports as a successful check with no spending', () => {
    expect(
      normalizeExport(
        `${header}\n10/01/2026,10/02/2026,Payment,,Other,Payment,-100`,
        'apple-card',
        true,
      ),
    ).toMatchObject({ rows: [], excluded: 1, total: 1 })
  })

  it('rejects malformed dates and rows rather than silently dropping data', () => {
    expect(() =>
      normalizeExport(
        'Date,Description,Amount\n2026-02-30,Shop,5',
        'spending-positive',
        true,
      ),
    ).toThrow('Nothing was imported')
    expect(() =>
      normalizeExport(
        'Date,Description,Amount\n2026-10-01,Shop,not money',
        'spending-positive',
        true,
      ),
    ).toThrow('Nothing was imported')
    expect(() => normalizeExport(header, 'apple-card', true)).toThrow(
      'export is empty',
    )
    expect(() =>
      normalizeExport(
        `${header}\n10/01/2026,10/02/2026,Unknown,Shop,Other,Mystery,100`,
        'apple-card',
        true,
      ),
    ).toThrow('Nothing was imported')
    expect(() =>
      normalizeExport(
        `${header}\n10/01/2026,10/02/2026,Shop,Shop,Other,Purchase,5`,
        'apple-card',
        false,
      ),
    ).toThrow('credit card account')
  })

  it('measures the size cap in bytes and says so from one message', () => {
    expect(EXPORT_TOO_LARGE).toBe(
      'That file is over 2 MB. Choose a smaller CSV export.',
    )
    expect(withinExportLimit('x'.repeat(MAX_EXPORT_BYTES))).toBe(true)
    expect(withinExportLimit('x'.repeat(MAX_EXPORT_BYTES + 1))).toBe(false)
    // Under the old character cap, over the byte cap: é is two UTF-8 bytes.
    const wide = 'é'.repeat(MAX_EXPORT_BYTES / 2 + 1)
    expect(wide.length).toBeLessThanOrEqual(MAX_EXPORT_BYTES)
    expect(withinExportLimit(wide)).toBe(false)
    expect(() =>
      normalizeExport(
        'x'.repeat(MAX_EXPORT_BYTES + 1),
        'spending-positive',
        true,
      ),
    ).toThrow(EXPORT_TOO_LARGE)
  })
})
