/**
 * Turning an exported row into Store, Account and Category names. The
 * generic part lives here; the Household's own names come from its Import
 * Rules (src/lib/import/rules.ts). A Store's name keys its Store Rules, so
 * change these only with care.
 */

import { EMPTY_RULES, compile, completeRules } from './rules'
import type { ImportRules } from './rules'

const PREFIX = /^(Pp|Wwp|Sq|Tst|Sp|Wf|Ddbr|Dd)\s*\*\s*/i

/** Chains whose descriptions vary by location or order number. */
const CHAINS: ReadonlyArray<[string, string]> = [
  ['Wayfair', 'Wayfair'],
  ['Amazon', 'Amazon'],
  ['Chick-fil-A', 'Chick-fil-A'],
  ['Starbucks', 'Starbucks'],
  ['Kroger', 'Kroger'],
  ['Publix', 'Publix'],
  ['Target', 'Target'],
  ['Costco', 'Costco'],
  ['Walmart', 'Walmart'],
]

export function storeName(
  description: string,
  rules: ImportRules = EMPTY_RULES,
): string {
  const d = description
    .replace(PREFIX, '')
    .replace(/^CHECK \d+$/, 'Paper checks')
    .replace(/^(ATM W\/D|IN PERSON CHECKING WITHDRAWAL).*/, 'Cash withdrawals')
    .replace(/^MOBILE \d+ DEPOSIT/, 'Mobile deposit')
    .replace(/\s+[\d#*]{4,}.*$/, '')
    .replace(/\s+(Inc|LLC|Corp)\.?$/i, '')
    .trim()
  const lower = d.toLowerCase()
  for (const [needle, name] of [...rules.stores, ...CHAINS])
    if (lower.includes(needle.toLowerCase())) return name
  return d.slice(0, 40)
}

/** Escrow payouts (and the Household's investments) aren't spending. */
export function isSpending(
  description: string,
  rules: ImportRules = EMPTY_RULES,
): boolean {
  if (description.includes('Disbursement')) return false
  return !compile(rules.notSpending)?.test(description)
}

/** The finance app's Category, re-filed into this Household's buckets. */
export function bucketCategory(
  category: string,
  description: string,
  store: string,
  rules: ImportRules = EMPTY_RULES,
  owners: ReadonlyArray<string> = [],
): string {
  const filed = completeRules(rules)
  const upkeep = compile(filed.upkeep, 'i')
  const hardware = filed.hardware.some(
    (name) =>
      name.length > 0 && description.toLowerCase().includes(name.toLowerCase()),
  )
  const excluded = compile(filed.upkeepExclude, 'i')?.test(description) ?? false
  if ((hardware || upkeep?.test(description)) && !excluded) return 'Home upkeep'
  if (store === 'Paper checks' || store === 'Cash withdrawals')
    return 'Checks & cash'
  if (filed.mortgageCategory && category === filed.mortgageCategory)
    return compile(filed.mortgage)?.test(description)
      ? 'Mortgage'
      : 'Utilities & phones'
  // Joint is the shared label, not a person. Other owners' export categories
  // are that person's spending.
  if (owners.some((owner) => owner !== 'Joint' && owner === category))
    return `${category} personal`
  return category
}
