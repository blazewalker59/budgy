/**
 * The Categories a fresh Ledger starts with, and how a Category the import
 * invents is filed, carried over from the planning artifact.
 */

import type { Category, Group, Tag } from './types'

const NEEDS = [
  'Groceries',
  'Childcare & education',
  'Healthcare',
  'Insurance',
  'Auto & transport',
  'Pets',
]
const NICE = [
  'Household',
  'Shopping',
  'Kids',
  'Subscriptions',
  'Travel & vacation',
  'Checks & cash',
  'Big Purchases',
  'Tithe',
  'Other',
]
const FLUFF = ['Drinks & dining', 'Entertainment', 'Personal spending']
export const HOUSING = ['Mortgage', 'Utilities & phones', 'Home upkeep']

export const DEFAULT_CATEGORIES: ReadonlyArray<Category> = [
  ...NEEDS.map((name) => ({
    name,
    tag: 'need' as Tag,
    group: 'everyday' as Group,
  })),
  ...NICE.map((name) => ({
    name,
    tag: 'nice' as Tag,
    group: 'everyday' as Group,
  })),
  ...FLUFF.map((name) => ({
    name,
    tag: 'fluff' as Tag,
    group: 'everyday' as Group,
  })),
  ...HOUSING.map((name) => ({
    name,
    tag: 'need' as Tag,
    group: 'housing' as Group,
  })),
]

/** A Category first seen in an import: Nice to have, unless it's Housing. */
export function newCategory(name: string): Category {
  const known = DEFAULT_CATEGORIES.find((c) => c.name === name)
  // Keep legacy per-person import categories classified as before, without
  // seeding another Household with the original Members' names.
  if (!known && name.endsWith(' personal'))
    return { name, tag: 'fluff', group: 'everyday' }
  return known ?? { name, tag: 'nice', group: 'everyday' }
}
