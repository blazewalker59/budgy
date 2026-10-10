/**
 * What each screen keeps in the URL: the Lens (every screen it applies to,
 * so it follows a Member around and a view can be shared or saved), plus
 * the screen's own view settings (a month, a period).
 */

import type { Lens } from '@/lib/model/lens'
import { readLens } from '@/lib/model/lens'

export type Period = 'month' | '3' | '6' | '12'

export interface OverviewSearch extends Lens {
  month?: string
}

export interface AccountsSearch extends Lens {
  /** The Rules tab, instead of the Accounts. */
  tab?: 'rules' | 'updates'
}

export interface SpendingSearch extends Lens {
  period?: Period
  month?: string
}

const MONTH = /^\d{4}-\d{2}$/

/** The Lens, from this URL or an older one (`owner`, comma-joined `acct`). */
function validateLensSearch(s: Record<string, unknown>): Lens {
  const raw = { ...s }
  if (typeof raw.owner === 'string' && raw.people === undefined)
    raw.people = [raw.owner]
  if (typeof raw.acct === 'string' && raw.accounts === undefined)
    raw.accounts = raw.acct.split(',').filter(Boolean)
  if (typeof raw.cat === 'string' && raw.categories === undefined)
    raw.categories = [raw.cat]
  return readLens(raw)
}

export function validateOverviewSearch(
  s: Record<string, unknown>,
): OverviewSearch {
  const out: OverviewSearch = validateLensSearch(s)
  if (typeof s.month === 'string' && MONTH.test(s.month)) out.month = s.month
  return out
}

export interface PlanSearch extends Lens {
  /** Planned bills, instead of the Budget. */
  tab?: 'bills'
}

export function validatePlanSearch(s: Record<string, unknown>): PlanSearch {
  const out: PlanSearch = validateLensSearch(s)
  if (s.tab === 'bills') out.tab = s.tab
  return out
}

export function validateAccountsSearch(
  s: Record<string, unknown>,
): AccountsSearch {
  const out: AccountsSearch = validateLensSearch(s)
  if (s.tab === 'rules' || s.tab === 'updates') out.tab = s.tab
  return out
}

export function validateSpendingSearch(
  s: Record<string, unknown>,
): SpendingSearch {
  const out: SpendingSearch = validateLensSearch(s)
  if (s.period === 'month' || s.period === '6' || s.period === '12')
    out.period = s.period
  else if (s.period === 6 || s.period === 12)
    out.period = String(s.period) as Period
  if (typeof s.month === 'string' && MONTH.test(s.month)) out.month = s.month
  return out
}

/** Only the Lens out of a screen's search, for a link to another screen. */
export function keepLens(prev: Record<string, unknown>): Lens {
  return readLens(prev)
}
