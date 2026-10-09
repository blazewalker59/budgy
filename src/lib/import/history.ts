/**
 * A balance history for one Account, read from whatever a bank or brokerage
 * gives: a CSV export, or two columns pasted from a spreadsheet. Each row
 * needs a date and a balance; with a header, a column named like "Balance"
 * or "Value" is the balance, else the last number in the row is.
 */

import { parseCsv } from './csv'

export interface HistoryRow {
  date: string
  /** Cents. */
  amount: number
}

export interface ParsedHistory {
  rows: Array<HistoryRow>
  /** Lines with no readable date and balance (headers aside). */
  skipped: number
  /** The header the balances came from, when there was one. */
  column: string | null
}

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

const BALANCE = /balance|value|amount|total|market|worth/i

export function parseBalanceHistory(text: string): ParsedHistory {
  const lines = text.includes('\t')
    ? text.split(/\r?\n/).map((l) => l.split('\t'))
    : parseCsv(text)
  const cells = lines.filter((r) => r.some((c) => c.trim() !== ''))

  let column: number | null = null
  let header: string | null = null
  const first = cells[0] as Array<string> | undefined
  if (first && !first.some((c) => readDate(c))) {
    const i = first.findIndex((c) => BALANCE.test(c))
    if (i >= 0) {
      column = i
      header = first[i].trim()
    }
    cells.shift()
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
    rows: [...byDate]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    skipped,
    column: header,
  }
}
