/**
 * Money in (docs/adr/0011): what came into a checking or savings Account.
 * It never counts as spending by itself; a Member says what each one is.
 * Shared by server and client: no database here.
 */

export const MONEY_IN_USES = ['review', 'income', 'transfer', 'offset'] as const
export type MoneyInUse = (typeof MONEY_IN_USES)[number]

export const MONEY_IN_LABELS: Record<MoneyInUse, string> = {
  review: 'To review',
  income: 'Income',
  transfer: 'Transfer',
  offset: 'Offset',
}

/** One incoming row, before it's saved. */
export interface IncomingRow {
  date: string
  description: string
  /** Cents, positive. */
  amount: number
  /** A connector's stable id, when it has one. */
  sourceId?: string
}

/** Money in as the client sees it. */
export interface MoneyIn {
  id: string
  account: string
  date: string
  month: string
  description: string
  store: string
  /** Cents, positive. */
  amount: number
  use: MoneyInUse
  category: string | null
  /** Cents taken off `category`, for an offset. */
  offset: number | null
  note: string | null
}

/** People paying the Household back: always worth a look. */
const PEER = /\b(venmo|zelle|cash ?app|square cash|paypal|apple cash)\b/i
const INCOME =
  /\b(payroll|direct dep(osit)?|dir dep|salary|interest|dividend|irs treas|tax ref(und)?)\b/i
const TRANSFER =
  /\b(transfer|xfer|trnsfr|payment|autopay|online banking|from (savings|checking|share))\b/i

/**
 * A first guess at what incoming money is. Paychecks and transfers between
 * the Household's own accounts rarely need a look; money from people
 * (Venmo, Zelle) and anything unrecognized waits for review.
 */
export function guessUse(description: string): MoneyInUse {
  if (PEER.test(description)) return 'review'
  if (INCOME.test(description)) return 'income'
  if (TRANSFER.test(description)) return 'transfer'
  return 'review'
}

export interface MoneyInMonth {
  month: string
  income: number
  offsets: number
  transfers: number
  toReview: number
  total: number
}

/** Each month's Money in by use, newest first. */
export function moneyInByMonth(
  items: ReadonlyArray<MoneyIn>,
): Array<MoneyInMonth> {
  const by = new Map<string, MoneyInMonth>()
  for (const m of items) {
    const row = by.get(m.month) ?? {
      month: m.month,
      income: 0,
      offsets: 0,
      transfers: 0,
      toReview: 0,
      total: 0,
    }
    row.total += m.amount
    if (m.use === 'income') row.income += m.amount
    else if (m.use === 'transfer') row.transfers += m.amount
    else if (m.use === 'offset') row.offsets += m.offset ?? m.amount
    else row.toReview += m.amount
    by.set(m.month, row)
  }
  return [...by.values()].sort((a, b) => b.month.localeCompare(a.month))
}
