// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ledger } from '../_setup/factories'
import type { Account } from '@/lib/model/types'
import { accountsOverTime } from '@/lib/model/accountsOverTime'
import { AccountsChart } from '@/components/accounts/AccountsChart'

const mocks = vi.hoisted(() => ({ ledger: null as unknown }))
// AccountName reads label colours from the book; nothing else is needed.
vi.mock('@/lib/ledger/book', () => ({
  useBook: () => ({ ix: { ledger: mocks.ledger } }),
}))
afterEach(cleanup)

const acct = (name: string, kind: Account['kind']): Account => ({
  name,
  sourceName: name,
  owner: 'Joint',
  kind,
  institution: null,
  closed: false,
  securedBy: null,
})

const book = ledger({
  accounts: [
    acct('Checking', 'checking'),
    acct('Savings', 'savings'),
    acct('Card', 'credit'),
  ],
  balances: [
    { account: 'Checking', date: '2026-11-01', amount: 500_000 },
    { account: 'Checking', date: '2026-11-03', amount: 450_000 },
    { account: 'Savings', date: '2026-11-01', amount: 1_000_000 },
    { account: 'Savings', date: '2026-11-04', amount: 1_020_000 },
    { account: 'Card', date: '2026-11-01', amount: 80_000 },
    { account: 'Card', date: '2026-11-04', amount: 120_000 },
  ],
})
mocks.ledger = book

function show() {
  render(
    <AccountsChart
      data={accountsOverTime(book, '2026-11-01', '2026-11-04')}
      today="2026-11-16"
      headline="Net worth −$700 since Nov 1"
    />,
  )
}

describe('AccountsChart', () => {
  it('shows how each kind of account moved since the first day', () => {
    show()
    expect(
      screen.getByRole('img', {
        name: 'Since Nov 1: Net worth −$700, Cash −$300, Credit cards −$400.',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: 'Cash, $14,700, −$300 since Nov 1: see its accounts',
      }),
    ).toBeTruthy()
  })

  it('opens a kind of account for its accounts, and back', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: /^Credit cards,/ }))
    expect(
      screen.getByRole('img', {
        name: 'Since Nov 1: Credit cards −$400, Card −$400.',
      }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All accounts' }))
    expect(screen.getByRole('button', { name: /^Cash,/ })).toBeTruthy()
  })
})
