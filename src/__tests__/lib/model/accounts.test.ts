import { describe, expect, it } from 'vitest'
import { ledger } from '@test/factories'
import type { Account } from '@/lib/model/types'
import {
  accountInput,
  activity,
  balanceByMonth,
  latestBalances,
  netWorth,
  netWorthByMonth,
  ownerNames,
  worth,
} from '@/lib/model/accounts'

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
  ...over,
})

const book = ledger({
  accounts: [
    acct('Checking', 'checking'),
    acct('Card', 'credit'),
    acct('529', 'education', { owner: 'Kid' }),
    acct('Old card', 'credit', { closed: true }),
  ],
  balances: [
    { account: 'Checking', date: '2026-08-31', amount: 500_000 },
    { account: 'Checking', date: '2026-09-30', amount: 700_000 },
    { account: 'Card', date: '2026-09-15', amount: 120_000 },
    { account: '529', date: '2026-07-01', amount: 1_000_000 },
    { account: 'Old card', date: '2026-07-01', amount: 50_000 },
    { account: 'Old card', date: '2026-08-10', amount: 0 },
  ],
})

describe('netWorth', () => {
  it('adds what is held and takes off what is owed, open accounts only', () => {
    expect(netWorth(book)).toEqual({
      assets: 1_700_000,
      debts: 120_000,
      net: 1_580_000,
    })
  })

  it('reads the balances as of a day', () => {
    expect(netWorth(book, '2026-09-01')).toEqual({
      assets: 1_500_000,
      debts: 0,
      net: 1_500_000,
    })
  })
})

describe('netWorthByMonth', () => {
  it('carries each balance forward until a newer one', () => {
    expect(
      netWorthByMonth(book, ['2026-07', '2026-08', '2026-09']).map((m) => [
        m.month,
        m.assets,
        m.debts,
      ]),
    ).toEqual([
      ['2026-07', 1_000_000, 50_000],
      ['2026-08', 1_500_000, 0],
      ['2026-09', 1_700_000, 120_000],
    ])
  })
})

describe('balanceByMonth', () => {
  it('is empty before the first balance', () => {
    expect(
      balanceByMonth(book.balances, 'Checking', [
        '2026-07',
        '2026-08',
        '2026-09',
      ]),
    ).toEqual([null, 500_000, 700_000])
  })
})

describe('latestBalances and worth', () => {
  it('keeps each account’s newest, and counts debts against', () => {
    expect(latestBalances(book.balances).get('Checking')?.date).toBe(
      '2026-09-30',
    )
    expect(worth({ kind: 'credit' }, 100)).toBe(-100)
    expect(worth({ kind: 'retirement' }, 100)).toBe(100)
  })
})

describe('activity', () => {
  it('says how far each account’s purchases reach', () => {
    const l = ledger({
      txns: [
        {
          id: 'a',
          date: '2026-09-02',
          month: '2026-09',
          account: 'Card',
          description: 'x',
          store: 'x',
          sourceCategory: 'y',
          amount: 1,
          category: null,
          note: null,
        },
        {
          id: 'b',
          date: '2026-09-20',
          month: '2026-09',
          account: 'Card',
          description: 'x',
          store: 'x',
          sourceCategory: 'y',
          amount: 1,
          category: null,
          note: null,
        },
      ],
    })
    expect(activity(l).get('Card')).toEqual({
      purchases: 2,
      first: '2026-09-02',
      last: '2026-09-20',
    })
  })
})

describe('accountInput and ownerNames', () => {
  it('trims, blanks an empty institution, refuses an unknown kind', () => {
    expect(
      accountInput.parse({
        name: ' 529 ',
        owner: 'Kid',
        kind: 'education',
        institution: '',
        closed: false,
      }),
    ).toEqual({
      name: '529',
      owner: 'Kid',
      kind: 'education',
      institution: null,
      closed: false,
    })
    expect(() =>
      accountInput.parse({
        name: 'x',
        owner: 'y',
        kind: 'crypto',
        institution: null,
        closed: false,
      }),
    ).toThrow()
  })

  it('lists the Household’s owners first, then any others in use', () => {
    expect(ownerNames(book.accounts, ['Joint', 'Blaze'])).toEqual([
      'Joint',
      'Blaze',
      'Kid',
    ])
  })
})
