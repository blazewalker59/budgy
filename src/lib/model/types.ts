/**
 * The Ledger's shapes, shared by server and browser (CONTEXT.md has the
 * language). Money is integer cents; dates are YYYY-MM-DD, months YYYY-MM.
 */

/** How much a Category matters: Need, Nice to have, or Fluff. */
export type Tag = 'need' | 'nice' | 'fluff'
export const TAGS: ReadonlyArray<Tag> = ['need', 'nice', 'fluff']
export const TAG_LABELS: Record<Tag, string> = {
  need: 'Need',
  nice: 'Nice to have',
  fluff: 'Fluff',
}

/** Everyday spending is what the Budget steers; Housing is fixed costs. */
export type Group = 'everyday' | 'housing'

export type Cadence = 'once' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'
export const CADENCES: ReadonlyArray<Cadence> = [
  'once',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
]
export const CADENCE_MONTHS: Record<Cadence, number> = {
  once: 0,
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}
export const CADENCE_LABELS: Record<Cadence, string> = {
  once: 'Once',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  semiannual: 'Twice a year',
  annual: 'Once a year',
}

/** Who an Account's spending belongs to. */
export const OWNERS = ['Joint', 'Blaze', 'Alex'] as const
export type Owner = string

export interface Category {
  name: string
  tag: Tag
  group: Group
}

export interface Account {
  name: string
  sourceName: string
  owner: Owner
}

export interface Txn {
  id: string
  date: string
  month: string
  account: string
  description: string
  store: string
  sourceCategory: string
  /** Cents; positive is spending, negative a refund. */
  amount: number
  /** This Transaction's own Move, if any. */
  category: string | null
  note: string | null
}

export interface StoreRule {
  sourceCategory: string
  store: string
  category: string | null
  tag: Tag | null
}

export interface Target {
  category: string
  startsMonth: string
  amount: number
}

export interface Plan {
  id: string
  name: string
  category: string
  store: string | null
  amount: number
  cadence: Cadence
  anchor: string
  active: boolean
}

export interface Ledger {
  categories: Array<Category>
  accounts: Array<Account>
  txns: Array<Txn>
  rules: Array<StoreRule>
  targets: Array<Target>
  plans: Array<Plan>
}
