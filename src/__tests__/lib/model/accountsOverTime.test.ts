import { describe, expect, it } from 'vitest'
import { ledger } from '@test/factories'
import type { Account } from '@/lib/model/types'
import { accountsOverTime, sampleDates } from '@/lib/model/accountsOverTime'
import { netWorth } from '@/lib/model/accounts'

const acct = (
  name: string,
  kind: Account['kind'],
  over: Partial<Account> = {},
): Account => ({
  name,
  sourceName: name,
  owner: 'Joint',
  kind,
  institution: null,
  closed: false,
  securedBy: null,
  ...over,
})

describe('sampleDates', () => {
  it('takes every day of a short span', () => {
    expect(sampleDates('2026-11-01', '2026-11-04')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ])
  })

  it('spaces a long span evenly, always ending on the last day', () => {
    const dates = sampleDates('2025-01-01', '2026-11-16', 10)
    expect(dates.length).toBeLessThanOrEqual(10)
    expect(dates[0]).toBe('2025-01-01')
    expect(dates[dates.length - 1]).toBe('2026-11-16')
  })

  it('has nothing for a span that runs backwards', () => {
    expect(sampleDates('2026-11-05', '2026-11-01')).toEqual([])
  })
})

describe('accountsOverTime', () => {
  const book = ledger({
    accounts: [
      acct('Checking', 'checking'),
      acct('Savings', 'savings'),
      acct('Card', 'credit'),
      acct('IRA', 'retirement'),
      acct('No balance', 'brokerage'),
    ],
    balances: [
      { account: 'Checking', date: '2026-11-01', amount: 500_000 },
      { account: 'Checking', date: '2026-11-03', amount: 450_000 },
      { account: 'Savings', date: '2026-11-02', amount: 1_000_000 },
      { account: 'Card', date: '2026-11-01', amount: 80_000 },
      { account: 'Card', date: '2026-11-04', amount: 120_000 },
      { account: 'IRA', date: '2026-10-01', amount: 5_000_000 },
    ],
  })
  const data = accountsOverTime(book, '2026-11-01', '2026-11-04')

  it('holds each Balance until the next, from its first', () => {
    const cash = data.groups.find((g) => g.title === 'Cash')!
    const checking = cash.accounts.find((a) => a.account.name === 'Checking')!
    expect(checking.values).toEqual([500_000, 500_000, 450_000, 450_000])
    const savings = cash.accounts.find((a) => a.account.name === 'Savings')!
    expect(savings.values).toEqual([0, 1_000_000, 1_000_000, 1_000_000])
    expect(cash.values).toEqual([500_000, 1_500_000, 1_450_000, 1_450_000])
  })

  it('counts what’s owed below zero, and groups in the screen’s order', () => {
    expect(data.groups.map((g) => [g.title, g.debt])).toEqual([
      ['Cash', false],
      ['Credit cards', true],
      ['Retirement', false],
    ])
    const card = data.groups.find((g) => g.title === 'Credit cards')!
    expect(card.values).toEqual([-80_000, -80_000, -80_000, -120_000])
  })

  it('puts a group’s biggest account first', () => {
    const cash = data.groups.find((g) => g.title === 'Cash')!
    expect(cash.accounts.map((a) => a.account.name)).toEqual([
      'Savings',
      'Checking',
    ])
  })

  it('adds up to net worth on every day', () => {
    data.dates.forEach((date, i) =>
      expect(data.net[i]).toBe(netWorth(book, date).net),
    )
  })

  it('follows the screen’s filter by its Accounts', () => {
    const cashOnly = accountsOverTime(
      { ...book, accounts: book.accounts.filter((a) => a.kind === 'checking') },
      '2026-11-01',
      '2026-11-04',
    )
    expect(cashOnly.groups.map((g) => g.title)).toEqual(['Cash'])
    expect(cashOnly.net).toEqual([500_000, 500_000, 450_000, 450_000])
  })
})
