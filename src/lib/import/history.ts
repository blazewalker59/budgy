/**
 * A balance history for one Account, read from whatever a bank or brokerage
 * gives: a CSV export, or two columns pasted from a spreadsheet. Each row
 * needs a date and a balance; with a header, a column named like "Balance"
 * or "Value" is the balance, else the last number in the row is.
 *
 * A transactions export (an "Amount" column, or Debit and Credit, but no
 * balance) isn't a balance history: it's read as changes instead, and the
 * balances are worked out backwards from one balance the Member knows
 * (rebuildBalances).
 */

import { parseCsv } from './csv'

export interface HistoryRow {
  date: string
  /** Cents. */
  amount: number
}

export interface BalanceHistory {
  kind: 'balances'
  rows: Array<HistoryRow>
  /** Lines with no readable date and balance (headers aside). */
  skipped: number
  /** The header the balances came from, when there was one. */
  column: string | null
}

export interface TransactionHistory {
  kind: 'transactions'
  /** Each row's date and amount, as exported (or Credit minus Debit). */
  changes: Array<HistoryRow>
  skipped: number
  /** The header(s) the amounts came from. */
  column: string
  /** Debit and Credit columns: the sign is known, money in is positive. */
  split: boolean
  /** Rows with a positive amount, for guessing which way the sign runs. */
  positive: number
}

export type ParsedHistory = BalanceHistory | TransactionHistory

const pad = (n: string) => n.padStart(2, '0')

/** "2026-01-31", "2026/1/31", "1/31/2026", "1/31/26" → YYYY-MM-DD. */
export function readDate(text: string): string | null {
  const s = text.trim()
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s)
  if (m) return valid(m[1], m[2], m[3])
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s)
  if (m) return valid(m[3].length === 2 ? `20${m[3]}` : m[3], m[1], m[2])
  return null
}

function valid(y: string, mo: string, d: string): string | null {
  const date = `${y}-${pad(mo)}-${pad(d)}`
  const t = new Date(`${date}T00:00:00Z`)
  return !isNaN(t.getTime()) && t.toISOString().startsWith(date) ? date : null
}

/** "$12,345.67", "(1,200.00)", "-50" → cents. */
export function readMoney(text: string): number | null {
  let s = text.trim().replace(/[$,\s]/g, '')
  let sign = 1
  if (/^\(.*\)$/.test(s)) {
    sign = -1
    s = s.slice(1, -1)
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return sign * Math.round(Number(s) * 100)
}

const BALANCE = [/balance/i, /value|worth|market|total/i]
const AMOUNT = /amount/i
const DEBIT = /debit|withdrawal/i
const CREDIT = /credit|deposit/i

export function parseBalanceHistory(text: string): ParsedHistory {
  const lines = text.includes('\t')
    ? text.split(/\r?\n/).map((l) => l.split('\t'))
    : parseCsv(text)
  const cells = lines.filter((r) => r.some((c) => c.trim() !== ''))

  let column: number | null = null
  let header: string | null = null
  const first = cells[0] as Array<string> | undefined
  if (first && !first.some((c) => readDate(c))) {
    cells.shift()
    for (const re of BALANCE) {
      const i = first.findIndex((c) => re.test(c))
      if (i >= 0) {
        column = i
        header = first[i].trim()
        break
      }
    }
    if (column === null) {
      const amount = first.findIndex((c) => AMOUNT.test(c))
      const debit = first.findIndex((c) => DEBIT.test(c))
      const credit = first.findIndex((c) => CREDIT.test(c))
      if (amount >= 0) return readChanges(cells, [amount], first[amount].trim())
      if (debit >= 0 && credit >= 0)
        return readChanges(
          cells,
          [credit, debit],
          `${first[credit].trim()} − ${first[debit].trim()}`,
        )
    }
  }

  const byDate = new Map<string, number>()
  let skipped = 0
  for (const row of cells) {
    const di = row.findIndex((c) => readDate(c))
    const date = di >= 0 ? readDate(row[di]) : null
    let amount: number | null = null
    if (column !== null) amount = readMoney(row[column] ?? '')
    else
      for (let i = row.length - 1; i >= 0 && amount === null; i--)
        if (i !== di) amount = readMoney(row[i])
    if (!date || amount === null) {
      skipped++
      continue
    }
    byDate.set(date, amount)
  }
  return {
    kind: 'balances',
    rows: [...byDate]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    skipped,
    column: header,
  }
}

/** Rows of a transactions export: one Amount column, or Credit and Debit. */
function readChanges(
  cells: Array<Array<string>>,
  [amountOrCredit, debit]: Array<number>,
  column: string,
): TransactionHistory {
  const changes: Array<HistoryRow> = []
  let skipped = 0
  let positive = 0
  for (const row of cells) {
    const di = row.findIndex((c) => readDate(c))
    const date = di >= 0 ? readDate(row[di]) : null
    let amount = readMoney(row[amountOrCredit] ?? '')
    if (debit !== undefined) {
      const out = readMoney(row[debit] ?? '')
      amount =
        amount === null && out === null
          ? null
          : (amount ?? 0) - Math.abs(out ?? 0)
    }
    if (!date || amount === null) {
      skipped++
      continue
    }
    if (amount > 0) positive++
    changes.push({ date, amount })
  }
  changes.sort((a, b) => (a.date < b.date ? -1 : 1))
  return {
    kind: 'transactions',
    changes,
    skipped,
    column,
    split: debit !== undefined,
    positive,
  }
}

/**
 * Which way a transactions export's amounts move the balance as the
 * Account shows it (+1: an amount adds to it). Most rows are spending, so
 * the usual sign of a row is the sign of spending: on a card, spending
 * adds to what's owed; in a bank account, it takes from what's held.
 */
export function guessDirection(h: TransactionHistory, debt: boolean): 1 | -1 {
  if (h.split) return debt ? -1 : 1
  const spendingPositive = h.positive > h.changes.length / 2
  return spendingPositive === debt ? 1 : -1
}

/**
 * Balances at each month's end, worked back from one known balance:
 * the balance on a day is the known one minus every change after it.
 * Changes after the known day are left out; the known balance is
 * included as the last row.
 */
export function rebuildBalances(
  changes: Array<HistoryRow>,
  direction: 1 | -1,
  known: HistoryRow,
): Array<HistoryRow> {
  const upTo = changes.filter((c) => c.date <= known.date)
  if (!upTo.length) return [known]
  const out: Array<HistoryRow> = []
  let month = upTo[0].date.slice(0, 7)
  const lastMonth = known.date.slice(0, 7)
  while (month < lastMonth) {
    const end = monthEnd(month)
    const after = upTo
      .filter((c) => c.date > end)
      .reduce((n, c) => n + c.amount, 0)
    out.push({ date: end, amount: known.amount - direction * after })
    month = nextMonth(month)
  }
  out.push(known)
  return out
}

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(day).padStart(2, '0')}`
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
