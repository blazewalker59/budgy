/**
 * Turning an exported row into Store, Account and Category names. The
 * generic part lives here; the Household's own names come from its Import
 * Rules (src/lib/import/rules.ts). A Store's name keys its Store Rules, so
 * change these only with care.
 */

import { EMPTY_RULES, compile } from './rules'
import type { ImportRules } from './rules'
import { OWNERS } from '@/lib/model/types'

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

/** "Bank - Card Name (1234)" → the Household's name for it, else "Card Name (1234)". */
export function accountName(
  sourceName: string,
  rules: ImportRules = EMPTY_RULES,
): string {
  return rules.accounts[sourceName] ?? sourceName.replace(/^[^-]+? - /, '')
}

/** Whose spending an Account is, until a Member says otherwise. */
export function defaultOwner(account: string): string {
  const first = account.split(' ')[0]
  return OWNERS.find((o) => o !== 'Joint' && o === first) ?? 'Joint'
}

/** Escrow payouts (and the Household's investments) aren't spending. */
export function isSpending(
  description: string,
  rules: ImportRules = EMPTY_RULES,
): boolean {
  if (description.includes('Disbursement')) return false
  return !compile(rules.notSpending)?.test(description)
}

const HARDWARE = /Lowe's|Home Depot|Ace Hardware/i

/** The finance app's Category, re-filed into this Household's buckets. */
export function bucketCategory(
  category: string,
  description: string,
  store: string,
  rules: ImportRules = EMPTY_RULES,
): string {
  const upkeep = compile(rules.upkeep, 'i')
  if (
    (HARDWARE.test(description) || upkeep?.test(description)) &&
    !description.toLowerCase().includes('golf')
  )
    return 'Home upkeep'
  if (store === 'Paper checks' || store === 'Cash withdrawals')
    return 'Checks & cash'
  if (category === 'Mortgage and Utilities')
    return compile(rules.mortgage)?.test(description)
      ? 'Mortgage'
      : 'Utilities & phones'
  if (
    (OWNERS as ReadonlyArray<string>).includes(category) &&
    category !== 'Joint'
  )
    return `${category} personal`
  return category
}
