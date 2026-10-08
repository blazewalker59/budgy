import { describe, expect, it } from 'vitest'
import type { ImportRules } from '@/lib/import/rules'
import { parseExport } from '@/lib/import/rows'
import { EMPTY_RULES, parseImportRules } from '@/lib/import/rules'
import {
  accountName,
  bucketCategory,
  defaultOwner,
  isSpending,
  storeName,
} from '@/lib/import/stores'

const HEADER =
  'Date,Description,Statement description,Type,Category,Amount,Account,Tags,Notes'

/** Made-up Household rules, shaped like the real ones in the database. */
const RULES: ImportRules = {
  accounts: { 'Big Bank - CARD ...0002 (0002)': 'Big Bank Visa' },
  stores: [['Green Lawn', 'Green Lawn Care']],
  upkeep: 'Green Lawn|^Bug Guys$',
  mortgage: 'Homeloan Servicing',
  notSpending: 'Index Fund',
}

describe('storeName', () => {
  it('strips processor prefixes and reference numbers', () => {
    expect(storeName('SQ *Blue Bottle 12345678')).toBe('Blue Bottle')
    expect(storeName('Amazon Mktpl*AB12CD')).toBe('Amazon')
    expect(storeName('CHECK 1032')).toBe('Paper checks')
    expect(storeName('ATM W/D 0042 MAIN ST')).toBe('Cash withdrawals')
    expect(storeName('Acme Widgets LLC')).toBe('Acme Widgets')
  })

  it('uses the Household’s own aliases first', () => {
    expect(storeName('GREEN LAWN 555-1234', RULES)).toBe('Green Lawn Care')
    expect(storeName('GREEN LAWN 555-1234')).toBe('GREEN LAWN 555-1234')
  })
})

describe('bucketCategory', () => {
  it('re-files home upkeep, mortgage, utilities and personal spending', () => {
    expect(bucketCategory('Shopping', "Lowe's #123", "Lowe's")).toBe(
      'Home upkeep',
    )
    expect(bucketCategory('Other', 'Bug Guys', 'Bug Guys', RULES)).toBe(
      'Home upkeep',
    )
    expect(
      bucketCategory(
        'Mortgage and Utilities',
        'Homeloan Servicing',
        'x',
        RULES,
      ),
    ).toBe('Mortgage')
    expect(
      bucketCategory('Mortgage and Utilities', 'Spectrum', 'x', RULES),
    ).toBe('Utilities & phones')
    expect(bucketCategory('Blaze', 'x', 'x')).toBe('Blaze personal')
    expect(bucketCategory('Other', 'CHECK 1', 'Paper checks')).toBe(
      'Checks & cash',
    )
    expect(bucketCategory('Entertainment', 'Home Depot golf', 'x')).toBe(
      'Entertainment',
    )
  })

  it('names Accounts and their default owners', () => {
    expect(accountName('Apple - Alex Apple Card')).toBe('Alex Apple Card')
    expect(accountName('Big Bank - CARD ...0002 (0002)', RULES)).toBe(
      'Big Bank Visa',
    )
    expect(accountName('Some New Bank')).toBe('Some New Bank')
    expect(defaultOwner('Alex Apple Card')).toBe('Alex')
    expect(defaultOwner('Joint Checking (0001)')).toBe('Joint')
  })

  it('leaves out escrow payouts and the Household’s investments', () => {
    expect(isSpending('Escrow Disbursement')).toBe(false)
    expect(isSpending('Index Fund Buy', RULES)).toBe(false)
    expect(isSpending('Index Fund Buy')).toBe(true)
  })
})

describe('parseImportRules', () => {
  it('reads stored rules and survives missing or broken ones', () => {
    expect(parseImportRules(JSON.stringify(RULES))).toEqual(RULES)
    expect(parseImportRules(null)).toEqual(EMPTY_RULES)
    expect(parseImportRules('{not json')).toEqual(EMPTY_RULES)
    expect(parseImportRules('{"upkeep":"("}')).toEqual(EMPTY_RULES)
  })
})

describe('parseExport', () => {
  const csv = [
    HEADER,
    '2026-09-02,Amazon Mktpl*AB12CD,,Expense,Shopping,-23.5,Apple - Blaze Apple Card,,',
    '2026-09-02,Amazon Mktpl*AB12CD,,Expense,Shopping,-23.5,Apple - Blaze Apple Card,,',
    '2026-03-03,Auto-Owners Insurance,,Expense,Insurance,-1210,Northside Bank - Joint Checking (0001),,',
    '2026-03-04,Refund Store,,Expense,Shopping,12.00,Apple - Blaze Apple Card,,',
    '2026-03-05,PAYROLL,,Income,Paycheck,4000,Northside Bank - Joint Checking (0001),,',
    '2026-03-06,Index Fund Buy,,Expense,Investments,-500,Northside Bank - Joint Checking (0001),,',
  ].join('\n')

  it('makes the same ids as the planning artifact (Python sha1)', async () => {
    const { txns } = await parseExport(csv, RULES)
    expect(txns.filter((t) => t.store === 'Amazon').map((t) => t.id)).toEqual([
      '5a94469c71',
      '01114e952c',
    ])
    expect(txns.find((t) => t.amount === 121_000)?.id).toBe('a83e09d42b')
  })

  it('keeps spending and refunds, skips income and investments', async () => {
    const { txns, skipped } = await parseExport(csv, RULES)
    expect(txns).toHaveLength(4)
    expect(txns.find((t) => t.store === 'Refund Store')?.amount).toBe(-1200)
    expect(skipped).toEqual({ notSpending: 1, otherTypes: 1, invalid: 0 })
  })

  it('refuses a file without the expected columns', async () => {
    await expect(parseExport('Date,Amount\n2026-01-01,5')).rejects.toThrow(
      /missing Description/,
    )
  })
})
