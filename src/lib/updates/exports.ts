/** Known CSV conventions, normalized to Budgy purchases. No sign guessing. */
import type { PostedRow } from '@/lib/import/posted'
import { parseCsv } from '@/lib/import/csv'
import { readDate, readMoney } from '@/lib/import/history'

export const EXPORT_FORMATS = [
  'apple-card',
  'spending-positive',
  'money-out-negative',
  'debit-credit',
] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export const EXPORT_LABELS: Record<ExportFormat, string> = {
  'apple-card': 'Apple Card CSV',
  'spending-positive': 'Card CSV — purchases are positive',
  'money-out-negative': 'Bank CSV — money out is negative',
  'debit-credit': 'Bank CSV — separate Debit and Credit columns',
}
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024
/** Where the share-sheet Shortcut sends an export (uploadEndpoint.ts). */
export const UPLOAD_PATH = '/api/updates/upload'
const MOVING =
  /\b(payment|autopay|transfer|xfer|deposit|payroll|direct dep|installment|interest earned|daily cash|cashback)\b/i
const REFUND = /\b(refund|return|reversal)\b/i

export function detectExport(text: string): ExportFormat | null {
  const header =
    parseCsv(text.replace(/^\uFEFF/, ''))[0]?.map((c) =>
      c.trim().toLowerCase(),
    ) ?? []
  if (
    header.includes('transaction date') &&
    header.includes('amount (usd)') &&
    header.includes('type')
  )
    return 'apple-card'
  if (header.includes('debit') && header.includes('credit'))
    return 'debit-credit'
  return null
}

/**
 * Whether a row is spending (or a refund of it), not money moving: payments,
 * transfers, deposits and rewards are left out. `cents` is positive for money
 * out; a bank Account's other incoming money isn't treated as a refund.
 */
export function isSpending(
  cents: number,
  description: string,
  kind: string,
  debt: boolean,
): boolean {
  if (
    cents === 0 ||
    MOVING.test(kind) ||
    /daily cash|cashback/i.test(description) ||
    (!/^(purchase|refund|credit|return|fee|interest)$/i.test(kind) &&
      MOVING.test(description))
  )
    return false
  return debt || cents > 0 || REFUND.test(`${kind} ${description}`)
}

export function normalizeExport(
  text: string,
  format: ExportFormat,
  debt: boolean,
) {
  if (new TextEncoder().encode(text).length > MAX_EXPORT_BYTES)
    throw new Error('That file is over 2 MB. Choose a smaller CSV export.')
  const cells = parseCsv(text.replace(/^\uFEFF/, '')).filter((r) =>
    r.some((c) => c.trim()),
  )
  const header = cells.shift()?.map((c) => c.trim().toLowerCase()) ?? []
  const column = (...names: Array<string>) => {
    for (const name of names) {
      const index = header.indexOf(name)
      if (index >= 0) return index
    }
    return -1
  }
  const date =
    format === 'apple-card'
      ? column('transaction date')
      : column('date', 'transaction date', 'posted date', 'posting date')
  const description = column(
    'merchant',
    'payee',
    'description',
    'memo',
    'details',
  )
  const fallbackDescription = column('description', 'memo', 'details')
  const amount = column('amount', 'amount (usd)', 'transaction amount')
  const debit = column('debit', 'withdrawal')
  const credit = column('credit', 'deposit')
  const type = column('type', 'transaction type')
  const category = column('category')
  const currency = column('currency', 'currency code')
  if (
    date < 0 ||
    description < 0 ||
    (format === 'debit-credit' ? debit < 0 || credit < 0 : amount < 0)
  )
    throw new Error(
      'This CSV is missing a date, description or amount column. Check the export format.',
    )
  if (
    format === 'apple-card' &&
    (!debt || type < 0 || column('amount (usd)') < 0)
  )
    throw new Error(
      'The Apple Card format needs an Apple Card CSV on a credit card account.',
    )
  if (cells.length > 20_000)
    throw new Error(
      'An export can have at most 20,000 rows. Split it into smaller date ranges.',
    )
  const rows: Array<PostedRow> = []
  const invalid: Array<number> = []
  let excluded = 0
  const dates: Array<string> = []
  for (const [index, cellsRow] of cells.entries()) {
    const day = readDate(cellsRow[date] ?? '')
    const desc = (
      cellsRow[description]?.trim() ||
      cellsRow[fallbackDescription]?.trim() ||
      ''
    ).slice(0, 200)
    const kind = cellsRow[type]?.trim() ?? ''
    let cents: number | null
    if (format === 'debit-credit') {
      const outgoing = cellsRow[debit]?.trim() ? readMoney(cellsRow[debit]) : 0
      const incoming = cellsRow[credit]?.trim()
        ? readMoney(cellsRow[credit])
        : 0
      cents =
        outgoing === null ||
        incoming === null ||
        outgoing < 0 ||
        incoming < 0 ||
        (outgoing > 0 && incoming > 0)
          ? null
          : outgoing - incoming
    } else {
      cents = readMoney(cellsRow[amount] ?? '')
      if (cents !== null && format === 'money-out-negative') cents = -cents
    }
    if (
      !day ||
      !desc ||
      cents === null ||
      !Number.isSafeInteger(cents) ||
      Math.abs(cents) > 100_000_000 ||
      (currency >= 0 && cellsRow[currency]?.trim().toUpperCase() !== 'USD')
    ) {
      invalid.push(index + 2)
      continue
    }
    dates.push(day)
    if (!isSpending(cents, desc, kind, debt)) {
      excluded++
      continue
    }
    if (format === 'apple-card') {
      if (/^(refund|credit|return)$/i.test(kind)) cents = -Math.abs(cents)
      else if (!/^(purchase|fee|interest)$/i.test(kind)) {
        invalid.push(index + 2)
        continue
      }
    }
    rows.push({
      date: day,
      description: desc,
      amount: cents / 100,
      category: cellsRow[category]?.trim().slice(0, 60) || null,
    })
  }
  if (invalid.length)
    throw new Error(
      `Couldn’t read ${invalid.length} row${invalid.length === 1 ? '' : 's'}, starting at line ${invalid[0]}. Nothing was imported. Check the dates, amounts and export format.`,
    )
  if (!cells.length)
    throw new Error('This export is empty. Choose a transactions CSV.')
  dates.sort()
  return {
    rows,
    excluded,
    fromDate: dates[0] ?? null,
    toDate: dates.at(-1) ?? null,
    total: cells.length,
  }
}
