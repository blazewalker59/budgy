/**
 * An exported CSV (Date, Description, Type, Category, Amount, Account, …)
 * into Ledger Transactions (Expense rows) and Income (Income rows); Transfers
 * are skipped.
 *
 * A Transaction's id hashes its date, Account, description, amount and how
 * many identical rows came before it, so importing an overlapping export
 * again adds nothing twice, and ids match the planning artifact's.
 */

import { parseCsvRecords } from './csv'
import { EMPTY_RULES } from './rules'
import {
  accountName,
  bucketCategory,
  isSpending,
  payerName,
  storeName,
} from './stores'
import type { ImportRules } from './rules'

export const REQUIRED_COLUMNS = [
  'Date',
  'Description',
  'Type',
  'Category',
  'Amount',
  'Account',
] as const

export interface ParsedTxn {
  id: string
  date: string
  month: string
  account: string
  accountSource: string
  description: string
  store: string
  sourceCategory: string
  amount: number
}

export interface ParsedIncome {
  id: string
  date: string
  month: string
  account: string
  accountSource: string
  description: string
  payer: string
  sourceCategory: string
  /** Cents, positive. */
  amount: number
}

export interface ParsedExport {
  txns: Array<ParsedTxn>
  income: Array<ParsedIncome>
  skipped: { notSpending: number; otherTypes: number; invalid: number }
}

export class ImportError extends Error {}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Python's `f"{x:.2f}"` for amounts with at most two decimals. */
function twoDecimals(dollars: number): string {
  return (Object.is(dollars, -0) ? 0 : dollars).toFixed(2)
}

function cmp(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export async function parseExport(
  text: string,
  rules: ImportRules = EMPTY_RULES,
): Promise<ParsedExport> {
  const { header, records } = parseCsvRecords(text)
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length)
    throw new ImportError(`This file is missing ${missing.join(', ')}.`)

  const skipped = { notSpending: 0, otherTypes: 0, invalid: 0 }
  const rows: Array<Omit<ParsedTxn, 'id'> & { dollars: number }> = []
  const incomeRows: Array<Omit<ParsedIncome, 'id'>> = []
  for (const r of records) {
    if (r.Type === 'Income') {
      const cents = Math.round(Number(r.Amount) * 100)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.Date) || !Number.isFinite(cents)) {
        skipped.invalid++
        continue
      }
      // Investment income and escrow payouts aren't take-home pay either.
      if (cents <= 0 || !isSpending(r.Description, rules)) {
        skipped.notSpending++
        continue
      }
      incomeRows.push({
        date: r.Date,
        month: r.Date.slice(0, 7),
        account: accountName(r.Account, rules),
        accountSource: r.Account,
        description: r.Description,
        payer: payerName(r.Description, rules),
        sourceCategory: r.Category,
        amount: cents,
      })
      continue
    }
    if (r.Type !== 'Expense') {
      skipped.otherTypes++
      continue
    }
    const dollars = -Number(r.Amount)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.Date) || !Number.isFinite(dollars)) {
      skipped.invalid++
      continue
    }
    if (!isSpending(r.Description, rules)) {
      skipped.notSpending++
      continue
    }
    const store = storeName(r.Description, rules)
    rows.push({
      date: r.Date,
      month: r.Date.slice(0, 7),
      account: accountName(r.Account, rules),
      accountSource: r.Account,
      description: r.Description,
      store,
      sourceCategory: bucketCategory(r.Category, r.Description, store, rules),
      amount: Math.round(dollars * 100),
      dollars,
    })
  }

  // The artifact numbered identical rows in this order; keep it so ids match.
  rows.sort(
    (a, b) =>
      cmp(a.date, b.date) ||
      cmp(a.account, b.account) ||
      cmp(a.sourceCategory, b.sourceCategory) ||
      cmp(a.store, b.store) ||
      cmp(a.dollars, b.dollars) ||
      cmp(a.description, b.description),
  )
  const seen = new Map<string, number>()
  const txns: Array<ParsedTxn> = []
  for (const { dollars, ...row } of rows) {
    const base = `${row.date}|${row.account}|${row.description}|${twoDecimals(dollars)}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    txns.push({ id: (await sha1Hex(`${base}|${n}`)).slice(0, 10), ...row })
  }

  incomeRows.sort(
    (a, b) =>
      cmp(a.date, b.date) ||
      cmp(a.account, b.account) ||
      cmp(a.amount, b.amount) ||
      cmp(a.description, b.description),
  )
  const seenIncome = new Map<string, number>()
  const income: Array<ParsedIncome> = []
  for (const row of incomeRows) {
    const base = `income|${row.date}|${row.account}|${row.description}|${row.amount}`
    const n = (seenIncome.get(base) ?? 0) + 1
    seenIncome.set(base, n)
    income.push({ id: (await sha1Hex(`${base}|${n}`)).slice(0, 10), ...row })
  }
  return { txns, income, skipped }
}
