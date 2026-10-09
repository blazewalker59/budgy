/**
 * The Ledger's shapes, shared by server and browser (CONTEXT.md has the
 * language). Money is integer cents; dates are YYYY-MM-DD, months YYYY-MM.
 */

import type { Lens } from './lens'

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

/** What kind of Account: where it sits in net worth. */
export type AccountKind =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'brokerage'
  | 'retirement'
  | 'education'
  | 'loan'
  | 'property'
  | 'other'
export const ACCOUNT_KINDS: ReadonlyArray<AccountKind> = [
  'checking',
  'savings',
  'credit',
  'brokerage',
  'retirement',
  'education',
  'loan',
  'property',
  'other',
]
export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit card',
  brokerage: 'Investments',
  retirement: 'Retirement',
  education: 'Education (529)',
  loan: 'Loan',
  property: 'Home & property',
  other: 'Other',
}
/** Kinds whose balance is owed, not held. */
export const DEBT_KINDS: ReadonlySet<AccountKind> = new Set(['credit', 'loan'])

export interface Account {
  name: string
  sourceName: string
  owner: Owner
  kind: AccountKind
  institution: string | null
  closed: boolean
  /** A loan's property (a mortgage's home), for that property's equity. */
  securedBy: string | null
}

export interface Balance {
  account: string
  date: string
  /** Cents, as the account shows it (a card's balance owed is positive). */
  amount: number
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

/** How often a paycheck comes. */
export type PayCadence = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
export const PAY_CADENCES: ReadonlyArray<PayCadence> = [
  'biweekly',
  'semimonthly',
  'weekly',
  'monthly',
]
export const PAY_CADENCE_LABELS: Record<PayCadence, string> = {
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Every month',
}
export const PAYCHECKS_PER_YEAR: Record<PayCadence, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
}

/** A paycheck the Household counts on, as a Member entered it. */
export interface PaySchedule {
  id: string
  name: string
  /** Take-home per paycheck, in cents. */
  amount: number
  cadence: PayCadence
  /** Any one payday (YYYY-MM-DD). */
  anchor: string
  /** Twice a month only: the other payday's day of the month (31 = last). */
  secondDay: number | null
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

/** A Lens kept under a name (its filters: src/lib/model/lens.ts). */
export interface SavedLens {
  id: string
  name: string
  lens: Lens
}

export interface Ledger {
  categories: Array<Category>
  accounts: Array<Account>
  txns: Array<Txn>
  pay: Array<PaySchedule>
  balances: Array<Balance>
  lenses: Array<SavedLens>
  rules: Array<StoreRule>
  targets: Array<Target>
  plans: Array<Plan>
}
