import { describe, expect, it } from 'vitest'
import {
  guessDirection,
  parseBalanceHistory,
  purchasesFrom,
  readDate,
  readMoney,
  rebuildBalances,
} from '@/lib/import/history'

describe('readDate and readMoney', () => {
  it('reads the usual date shapes, and refuses impossible ones', () => {
    expect(readDate('2026-01-31')).toBe('2026-01-31')
    expect(readDate('2026/1/5')).toBe('2026-01-05')
    expect(readDate('1/31/2026')).toBe('2026-01-31')
    expect(readDate('1/31/26')).toBe('2026-01-31')
    expect(readDate('2/30/2026')).toBeNull()
    expect(readDate('Balance')).toBeNull()
  })

  it('reads dollars with signs, commas and parentheses', () => {
    expect(readMoney('$12,345.67')).toBe(1_234_567)
    expect(readMoney('(1,200.00)')).toBe(-120_000)
    expect(readMoney('-50')).toBe(-5000)
    expect(readMoney('n/a')).toBeNull()
  })
})

describe('parseBalanceHistory', () => {
  it('takes the column named like a balance from a CSV export', () => {
    const csv = [
      'Date,Contributions,Market Value,Note',
      '12/31/2025,"$1,000.00","$52,000.10",year end',
      '01/31/2026,"$1,000.00","$53,500.00",',
    ].join('\n')
    expect(parseBalanceHistory(csv)).toEqual({
      kind: 'balances',
      rows: [
        { date: '2025-12-31', amount: 5_200_010 },
        { date: '2026-01-31', amount: 5_350_000 },
      ],
      skipped: 0,
      column: 'Market Value',
    })
  })

  it('reads two columns pasted from a spreadsheet, without a header', () => {
    const pasted = '2026-02-28\t$10,000\n2026-01-31\t9,500.50\n\nnot a row\tx'
    const p = parseBalanceHistory(pasted)
    if (p.kind !== 'balances') throw new Error('balances expected')
    expect(p.rows).toEqual([
      { date: '2026-01-31', amount: 950_050 },
      { date: '2026-02-28', amount: 1_000_000 },
    ])
    expect(p).toMatchObject({ skipped: 1, column: null })
  })

  it('keeps one balance per day, the last given', () => {
    const p = parseBalanceHistory('2026-01-31,100\n2026-01-31,200')
    if (p.kind !== 'balances') throw new Error('balances expected')
    expect(p.rows).toEqual([{ date: '2026-01-31', amount: 20_000 }])
  })
})

describe('a transactions export', () => {
  // The shape a card's export has: purchases positive, payments negative.
  const card = [
    'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By',
    '01/05/2026,01/06/2026,COFFEE,Coffee,Restaurants,Purchase,5.00,A',
    '01/20/2026,01/21/2026,GROCER,Grocer,Grocery,Purchase,95.00,A',
    '02/03/2026,02/03/2026,PAYMENT,Card,Payment,Payment,-100.00,A',
    '02/10/2026,02/11/2026,GAS,Gas,Gas,Purchase,40.00,A',
    '03/02/2026,03/02/2026,SHOES,Shoes,Shopping,Purchase,60.00,A',
  ].join('\n')

  it('is read as changes, never as balances', () => {
    const p = parseBalanceHistory(card)
    expect(p).toMatchObject({
      kind: 'transactions',
      column: 'Amount (USD)',
      split: false,
      positive: 4,
      skipped: 0,
    })
    if (p.kind !== 'transactions') return
    // The clean Merchant name wins over the raw Description.
    expect(p.changes[0]).toEqual({
      date: '2026-01-05',
      amount: 500,
      description: 'Coffee',
      category: 'Restaurants',
      type: 'Purchase',
    })
  })

  it('knows spending adds to a card’s balance and takes from a bank’s', () => {
    const p = parseBalanceHistory(card)
    if (p.kind !== 'transactions') throw new Error('transactions expected')
    expect(guessDirection(p, true)).toBe(1)
    // A bank export with spending negative.
    const bank = parseBalanceHistory(
      'Date,Description,Amount\n2026-01-02,Rent,-1000\n2026-01-03,Food,-50\n2026-01-15,Pay,2000',
    )
    if (bank.kind !== 'transactions') throw new Error('transactions expected')
    expect(guessDirection(bank, false)).toBe(1)
    expect(guessDirection(bank, true)).toBe(-1)
  })

  it('reads Debit and Credit columns as money out and in', () => {
    const p = parseBalanceHistory(
      'Date,Description,Debit,Credit\n2026-01-02,Rent,1000,\n2026-01-15,Pay,,2000',
    )
    expect(p).toMatchObject({ kind: 'transactions', split: true })
    if (p.kind !== 'transactions') return
    expect(p.changes.map((c) => c.amount)).toEqual([-100_000, 200_000])
    expect(guessDirection(p, false)).toBe(1)
  })

  it('uses a running Balance column when the export has one, keeping its transactions', () => {
    const p = parseBalanceHistory(
      'Date,Description,Amount,Balance\n2026-01-02,Rent,-1000,4000\n2026-01-15,Pay,2000,6000',
    )
    expect(p).toMatchObject({ kind: 'balances', column: 'Balance' })
    if (p.kind !== 'balances') return
    expect(p.changes?.changes.map((c) => [c.description, c.amount])).toEqual([
      ['Rent', -100_000],
      ['Pay', 200_000],
    ])
  })
})

describe('purchasesFrom', () => {
  it('makes a card’s spending its purchases, leaving out payments', () => {
    const p = parseBalanceHistory(
      [
        'Transaction Date,Description,Merchant,Category,Type,Amount (USD)',
        '01/05/2026,COFFEE 123,Coffee,Restaurants,Purchase,5.00',
        '01/06/2026,BOOKS,Books,Shopping,Purchase,20.00',
        '01/07/2026,SHOES,Shoes,Shopping,Credit,-60.00',
        '02/03/2026,ACH PAYMENT,Card,Payment,Payment,-100.00',
        '02/04/2026,,,,Purchase,12.00',
      ].join('\n'),
    )
    if (p.kind !== 'transactions') throw new Error('transactions expected')
    const out = purchasesFrom(p, guessDirection(p, true), true)
    expect(out.rows).toEqual([
      {
        date: '2026-01-05',
        description: 'Coffee',
        amount: 5,
        category: 'Restaurants',
      },
      {
        date: '2026-01-06',
        description: 'Books',
        amount: 20,
        category: 'Shopping',
      },
      {
        date: '2026-01-07',
        description: 'Shoes',
        amount: -60,
        category: 'Shopping',
      },
    ])
    expect(out).toMatchObject({ moving: 1, unnamed: 1, moneyIn: 0 })
  })

  it('leaves out a bank’s deposits and transfers but keeps refunds', () => {
    const p = parseBalanceHistory(
      [
        'Date,Description,Amount',
        '2026-01-02,Hardware Store,-80',
        '2026-01-03,Grocer,-50',
        '2026-01-04,Grocer refund,10',
        '2026-01-15,Employer,2000',
        '2026-01-16,Online Transfer to Savings,-500',
      ].join('\n'),
    )
    if (p.kind !== 'transactions') throw new Error('transactions expected')
    const out = purchasesFrom(p, guessDirection(p, false), false)
    expect(out.rows.map((r) => [r.description, r.amount])).toEqual([
      ['Hardware Store', 80],
      ['Grocer', 50],
      ['Grocer refund', -10],
    ])
    expect(out).toMatchObject({ moving: 1, moneyIn: 1 })
  })

  it('follows a flipped direction', () => {
    const p = parseBalanceHistory(
      'Date,Description,Amount\n2026-01-02,Lunch,15',
    )
    if (p.kind !== 'transactions') throw new Error('transactions expected')
    expect(purchasesFrom(p, 1, true).rows[0].amount).toBe(15)
    expect(purchasesFrom(p, -1, true).rows[0].amount).toBe(-15)
  })
})

describe('rebuildBalances', () => {
  it('works month-end balances back from one known balance', () => {
    const p = parseBalanceHistory(
      [
        'Transaction Date,Amount (USD)',
        '01/05/2026,5.00',
        '01/20/2026,95.00',
        '02/03/2026,-100.00',
        '02/10/2026,40.00',
        '03/02/2026,60.00',
      ].join('\n'),
    )
    if (p.kind !== 'transactions') throw new Error('transactions expected')
    // $300 owed on Mar 10: Mar added 60, Feb added -60, Jan added 100.
    expect(
      rebuildBalances(p.changes, 1, { date: '2026-03-10', amount: 30_000 }),
    ).toEqual([
      { date: '2026-01-31', amount: 30_000 - 6000 + 6000 },
      { date: '2026-02-28', amount: 30_000 - 6000 },
      { date: '2026-03-10', amount: 30_000 },
    ])
  })

  it('leaves out changes after the known day', () => {
    expect(
      rebuildBalances(
        [
          { date: '2026-01-10', amount: 100 },
          { date: '2026-02-10', amount: 500 },
        ],
        1,
        { date: '2026-01-31', amount: 1000 },
      ),
    ).toEqual([{ date: '2026-01-31', amount: 1000 }])
  })
})
