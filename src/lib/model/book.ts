/**
 * The Book: the Ledger indexed once, with every Planned Expense's due dates
 * matched to payments. Built in the browser for the screens and on the
 * server for the Agents' tools. Pure.
 */

import { addMonths } from './dates'
import { indexLedger } from './ledger'
import { plannedTxnIds, schedule } from './plans'
import type { LedgerIndex } from './ledger'
import type { Occurrence } from './plans'
import type { Ledger } from './types'

export interface Book {
  ix: LedgerIndex
  today: string
  /** Due dates from the first Transaction through 18 months ahead. */
  occurrences: Array<Occurrence>
  plannedIds: Set<string>
  /** Months that have Transactions, oldest first. */
  months: Array<string>
}

export function buildBook(ledger: Ledger, today: string): Book {
  const ix = indexLedger(ledger)
  const first = ledger.txns.reduce(
    (min, t) => (t.date < min ? t.date : min),
    today,
  )
  const occurrences = schedule(ix, first, addMonths(today, 18))
  const months = [...new Set(ledger.txns.map((t) => t.month))].sort()
  return {
    ix,
    today,
    occurrences,
    plannedIds: plannedTxnIds(occurrences),
    months,
  }
}
