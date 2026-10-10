/**
 * Gaps in the imports: an Account that usually has Transactions but has
 * none for the end of a month is probably missing from the last export,
 * which makes that month look cheaper than it was.
 */

import { addDays, lastDayOf, shiftMonth } from './dates'
import { everyTxn } from './ledger'
import type { LedgerIndex } from './ledger'

/** Purchases in three months that make an Account one we'd miss. */
const REGULAR_USE = 6

export interface Gap {
  account: string
  /** Its latest Transaction. */
  last: string
}

export function coverageGaps(
  ix: LedgerIndex,
  month: string,
  today: string,
): Array<Gap> {
  const end = lastDayOf(month) < today ? lastDayOf(month) : today
  const recent = shiftMonth(month, -3)
  const last = new Map<string, string>()
  // Purchases in the three months before: an Account in regular use.
  // Transfers count: they come in with its exports like any purchase.
  const before = new Map<string, number>()
  for (const t of everyTxn(ix)) {
    if (t.date <= end && (last.get(t.account) ?? '') < t.date)
      last.set(t.account, t.date)
    if (t.month >= recent && t.month < month)
      before.set(t.account, (before.get(t.account) ?? 0) + 1)
  }
  return [...before]
    .filter(([, n]) => n >= REGULAR_USE)
    .map(([account]) => account)
    .map((account) => ({ account, last: last.get(account) ?? '' }))
    .filter((g) => g.last < addDays(end, -10))
    .sort((a, b) => a.account.localeCompare(b.account))
}
