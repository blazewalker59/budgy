/**
 * Sample exports for the demo sandbox (docs/adr/0015): synthetic purchases
 * at common chains over the last five months, made fresh for today so the
 * history step always has recent months. The same day gives the same file.
 * Pure: the admin page and the demo banner make them in the browser.
 */
import { addDays, addMonths } from '@/lib/model/dates'

export type SampleKind = 'apple-card' | 'bank' | 'balances'

export const SAMPLES: ReadonlyArray<{
  kind: SampleKind
  file: string
  label: string
  /** How to bring it in, as a Member would. */
  how: string
}> = [
  {
    kind: 'apple-card',
    file: 'sample-apple-card.csv',
    label: 'Apple Card export',
    how: 'Add a credit card Account, then upload it as “Apple Card CSV”.',
  },
  {
    kind: 'bank',
    file: 'sample-checking.csv',
    label: 'Checking export',
    how: 'Add a checking Account, then upload it as “Bank CSV — money out is negative”. Paychecks come in as Money in.',
  },
  {
    kind: 'balances',
    file: 'sample-savings-balances.csv',
    label: 'Savings balance history',
    how: 'Add a savings Account and paste or upload it as its balance history.',
  },
]

const MONTHS = 5

/** mulberry32: small, seeded, the same everywhere. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedOf(text: string) {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h
}

interface Spot {
  store: string
  category: string
  /** Visits a month, roughly. */
  often: number
  low: number
  high: number
}

/** Apple Card's own category names, as its export has them. */
const CARD: ReadonlyArray<Spot> = [
  { store: 'Trader Joe’s', category: 'Grocery', often: 4, low: 35, high: 120 },
  {
    store: 'Whole Foods Market',
    category: 'Grocery',
    often: 2,
    low: 20,
    high: 95,
  },
  { store: 'Starbucks', category: 'Restaurants', often: 6, low: 4, high: 14 },
  { store: 'Chipotle', category: 'Restaurants', often: 3, low: 11, high: 32 },
  {
    store: 'Panera Bread',
    category: 'Restaurants',
    often: 1,
    low: 12,
    high: 40,
  },
  { store: 'Shell', category: 'Gas', often: 3, low: 30, high: 65 },
  { store: 'Target', category: 'Shopping', often: 2, low: 15, high: 140 },
  { store: 'Amazon', category: 'Shopping', often: 4, low: 9, high: 85 },
  { store: 'Uber', category: 'Transportation', often: 1, low: 12, high: 38 },
  { store: 'CVS Pharmacy', category: 'Health', often: 1, low: 8, high: 45 },
  { store: 'The Home Depot', category: 'Other', often: 1, low: 18, high: 160 },
  {
    store: 'AMC Theatres',
    category: 'Entertainment',
    often: 0.5,
    low: 25,
    high: 60,
  },
]

const MONTHLY_CARD: ReadonlyArray<
  Omit<Spot, 'often' | 'low'> & { day: number }
> = [
  { store: 'Netflix', category: 'Entertainment', high: 15.49, day: 9 },
  { store: 'Spotify', category: 'Entertainment', high: 11.99, day: 14 },
]

const BANK: ReadonlyArray<Spot> = [
  {
    store: 'COSTCO WHSE #0482',
    category: 'Groceries',
    often: 2,
    low: 80,
    high: 260,
  },
  { store: 'KROGER #614', category: 'Groceries', often: 2, low: 25, high: 110 },
  { store: 'CHEVRON 0091', category: 'Gas', often: 2, low: 35, high: 70 },
  { store: 'WALGREENS #3310', category: 'Health', often: 1, low: 6, high: 40 },
  { store: 'LYFT *RIDE', category: '', often: 1, low: 9, high: 30 },
]

const money = (n: number) => n.toFixed(2)
const us = (date: string) =>
  `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(0, 4)}`
const cell = (text: string) =>
  /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text

/** Every day from five months before this month's start, through today. */
function days(today: string): Array<string> {
  const out: Array<string> = []
  for (
    let d = addMonths(`${today.slice(0, 7)}-01`, -MONTHS);
    d <= today;
    d = addDays(d, 1)
  )
    out.push(d)
  return out
}

interface Row {
  date: string
  store: string
  category: string
  /** Positive is money out. */
  amount: number
  type?: string
}

function visits(today: string, spots: ReadonlyArray<Spot>, seed: string) {
  const next = random(seedOf(seed + today))
  const rows: Array<Row> = []
  for (const date of days(today))
    for (const spot of spots)
      if (next() < spot.often / 30)
        rows.push({
          date,
          store: spot.store,
          category: spot.category,
          amount:
            Math.round((spot.low + next() * (spot.high - spot.low)) * 100) /
            100,
        })
  return rows
}

function appleCard(today: string): string {
  const rows = visits(today, CARD, 'card')
  for (const date of days(today)) {
    const day = Number(date.slice(8, 10))
    for (const bill of MONTHLY_CARD)
      if (day === bill.day)
        rows.push({
          date,
          store: bill.store,
          category: bill.category,
          amount: bill.high,
        })
    if (day === 25) {
      const owed = rows
        .filter((r) => r.date < date && r.date >= addMonths(date, -1))
        .reduce((sum, r) => sum + r.amount, 0)
      rows.push({
        date,
        store: 'Payment',
        category: 'Payment',
        amount: -Math.round(owed * 100) / 100,
        type: 'Payment',
      })
    }
  }
  // One return, so the sample shows a refund.
  const bought = rows.find((r) => r.store === 'Target')
  if (bought)
    rows.push({
      ...bought,
      date:
        addDays(bought.date, 6) <= today
          ? addDays(bought.date, 6)
          : bought.date,
      amount: -bought.amount,
      type: 'Credit',
    })
  rows.sort((a, b) => b.date.localeCompare(a.date))
  const lines = rows.map((r) =>
    [
      us(r.date),
      us(addDays(r.date, 1) <= today ? addDays(r.date, 1) : r.date),
      cell(
        r.type === 'Payment'
          ? 'ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 0000'
          : `${r.store.toUpperCase()} ${r.date.slice(5, 7)}${r.date.slice(8, 10)}`,
      ),
      cell(r.type === 'Payment' ? 'Apple Card' : r.store),
      r.category,
      r.type ?? 'Purchase',
      money(r.amount),
      'Demo',
    ].join(','),
  )
  return [
    'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By',
    ...lines,
  ].join('\n')
}

function bank(today: string): string {
  const rows = visits(today, BANK, 'bank').map((r) => ({
    ...r,
    description: `POS PURCHASE ${r.store}`,
  }))
  const extra: Array<Row & { description: string }> = []
  for (const date of days(today)) {
    const day = Number(date.slice(8, 10))
    const month = Number(date.slice(5, 7))
    if (day === 1 || day === 15)
      extra.push({
        date,
        store: 'ACME CORP',
        description: 'ACME CORP PAYROLL DIRECT DEP',
        category: 'Paycheck',
        amount: -2450,
      })
    if (day === 3)
      extra.push({
        date,
        store: 'CITY WATER',
        description: 'CITY WATER UTILITY BILL',
        category: 'Utilities',
        amount: 48.12 + (month % 3) * 6.5,
      })
    if (day === 12)
      extra.push({
        date,
        store: 'COMCAST',
        description: 'COMCAST CABLE ONLINE',
        category: 'Internet',
        amount: 79.99,
      })
    if (day === 20)
      extra.push({
        date,
        store: 'VERIZON WIRELESS',
        description: 'VERIZON WIRELESS ONLINE PMT',
        category: '',
        amount: 92.4,
      })
    if (day === 28)
      extra.push({
        date,
        store: 'SAVINGS',
        description: 'TRANSFER TO SAVINGS',
        category: 'Transfer',
        amount: 500,
      })
  }
  // A lumpy bill, for the Plan's bills step.
  const insurance = days(today).find((d) => d.slice(8, 10) === '18')
  if (insurance)
    extra.push({
      date: insurance,
      store: 'STATE FARM',
      description: 'STATE FARM INSURANCE PREMIUM',
      category: 'Insurance',
      amount: 612.5,
    })
  const all = [...rows, ...extra].sort((a, b) => a.date.localeCompare(b.date))
  return [
    'Date,Description,Amount,Category',
    ...all.map((r) =>
      [r.date, cell(r.description), money(-r.amount), cell(r.category)].join(
        ',',
      ),
    ),
  ].join('\n')
}

function balances(today: string): string {
  const next = random(seedOf(`savings${today}`))
  const lines: Array<string> = []
  let balance = 8200
  for (const date of days(today))
    if (date.slice(8, 10) === '28' || date === today) {
      balance += 500 + Math.round(next() * 4000) / 100
      lines.push(`${date},${money(balance)}`)
    }
  return ['Date,Balance', ...lines].join('\n')
}

/** The sample file of this kind, dated up to `today` (YYYY-MM-DD). */
export function sampleCsv(kind: SampleKind, today: string): string {
  switch (kind) {
    case 'apple-card':
      return appleCard(today)
    case 'bank':
      return bank(today)
    case 'balances':
      return balances(today)
  }
}
