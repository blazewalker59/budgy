import { describe, expect, it } from 'vitest'
import type { ImportRules } from '@/lib/import/rules'
import { EMPTY_RULES, parseImportRules } from '@/lib/import/rules'
import { bucketCategory, isSpending, storeName } from '@/lib/import/stores'

/** Made-up Household rules, shaped like the real ones in the database. */
const RULES: ImportRules = {
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
