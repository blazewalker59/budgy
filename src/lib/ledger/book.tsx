/**
 * The Book: the Ledger indexed once, with every Planned Expense's due dates
 * matched to payments, shared by every screen through context.
 */

import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { LedgerIndex } from '@/lib/model/ledger'
import type { Occurrence } from '@/lib/model/plans'
import type { Ledger } from '@/lib/model/types'
import { indexLedger } from '@/lib/model/ledger'
import { plannedTxnIds, schedule } from '@/lib/model/plans'
import { addMonths, today as todayIn } from '@/lib/model/dates'

export interface Book {
  ix: LedgerIndex
  today: string
  /** Due dates from the first Transaction through 18 months ahead. */
  occurrences: Array<Occurrence>
  plannedIds: Set<string>
  /** Months that have Transactions, oldest first. */
  months: Array<string>
}

const BookContext = createContext<Book | null>(null)

export function BookProvider({
  ledger,
  children,
}: {
  ledger: Ledger
  children: ReactNode
}) {
  const book = useMemo((): Book => {
    const ix = indexLedger(ledger)
    const today = todayIn()
    const first = ledger.txns[0]?.date ?? today
    const occurrences = schedule(ix, first, addMonths(today, 18))
    const months = [...new Set(ledger.txns.map((t) => t.month))].sort()
    return {
      ix,
      today,
      occurrences,
      plannedIds: plannedTxnIds(occurrences),
      months,
    }
  }, [ledger])
  return <BookContext.Provider value={book}>{children}</BookContext.Provider>
}

export function useBook(): Book {
  const book = useContext(BookContext)
  if (!book) throw new Error('useBook outside BookProvider')
  return book
}
