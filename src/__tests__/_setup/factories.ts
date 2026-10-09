import type { Income, Ledger, Plan, Txn } from '@/lib/model/types'
import { DEFAULT_CATEGORIES } from '@/lib/model/defaults'

let n = 0

export function txn(over: Partial<Txn> = {}): Txn {
  const date = over.date ?? '2026-09-10'
  return {
    id: `t${++n}`,
    date,
    month: date.slice(0, 7),
    account: 'Blaze Apple Card',
    description: over.store ?? 'Kroger',
    store: 'Kroger',
    sourceCategory: 'Groceries',
    amount: 5000,
    category: null,
    note: null,
    ...over,
  }
}

export function pay(over: Partial<Income> = {}): Income {
  const date = over.date ?? '2026-09-04'
  return {
    id: `i${++n}`,
    date,
    month: date.slice(0, 7),
    account: 'Joint Checking (0001)',
    payer: 'PAYROLL ACME',
    sourceCategory: 'Paycheck',
    amount: 200_000,
    ...over,
  }
}

export function plan(over: Partial<Plan> = {}): Plan {
  return {
    id: `pe_${++n}abcdef`,
    name: 'Car insurance',
    category: 'Insurance',
    store: 'Auto-Owners Insurance',
    amount: 120_000,
    cadence: 'semiannual',
    anchor: '2026-03-03',
    active: true,
    ...over,
  }
}

export function ledger(over: Partial<Ledger> = {}): Ledger {
  return {
    categories: [...DEFAULT_CATEGORIES],
    accounts: [
      { name: 'Blaze Apple Card', sourceName: 'Apple - Blaze', owner: 'Blaze' },
      { name: 'Alex Apple Card', sourceName: 'Apple - Alex', owner: 'Alex' },
      { name: 'Joint Checking (0001)', sourceName: 'Bank', owner: 'Joint' },
    ],
    txns: [],
    income: [],
    rules: [],
    targets: [],
    plans: [],
    ...over,
  }
}
