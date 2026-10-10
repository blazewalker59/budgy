/**
 * The Book (src/lib/model/book.ts), built once per Ledger and shared by
 * every screen through context.
 */

import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Book } from '@/lib/model/book'
import type { Ledger } from '@/lib/model/types'
import { buildBook } from '@/lib/model/book'
import { today } from '@/lib/model/dates'

export type { Book } from '@/lib/model/book'

const BookContext = createContext<Book | null>(null)

export function BookProvider({
  ledger,
  timeZone,
  children,
}: {
  ledger: Ledger
  timeZone: string
  children: ReactNode
}) {
  const book = useMemo(
    () => buildBook(ledger, today(timeZone)),
    [ledger, timeZone],
  )
  return <BookContext.Provider value={book}>{children}</BookContext.Provider>
}

export function useBook(): Book {
  const book = useContext(BookContext)
  if (!book) throw new Error('useBook outside BookProvider')
  return book
}
