import { describe, expect, it } from 'vitest'
import {
  keepLens,
  validateAccountsSearch,
  validateOverviewSearch,
  validatePlanSearch,
  validateSpendingSearch,
  withLensSearch,
} from '@/lib/ledger/search'

describe('screen search', () => {
  it('reads a Lens, including the older owner, acct, and cat names', () => {
    expect(validateOverviewSearch({ owner: 'Alex' })).toMatchObject({
      people: ['Alex'],
    })
    expect(validateSpendingSearch({ acct: 'A,B' })).toMatchObject({
      accounts: ['A', 'B'],
    })
    expect(validateAccountsSearch({ cat: 'Groceries' })).toMatchObject({
      categories: ['Groceries'],
    })
    expect(
      validatePlanSearch({ people: ['Alex'], owner: 'Blaze' }),
    ).toMatchObject({ people: ['Alex'] })
  })

  it('keeps each screen’s own settings and drops what it does not understand', () => {
    expect(
      validateOverviewSearch({ month: '2026-10', owner: 'Alex' }),
    ).toMatchObject({
      month: '2026-10',
      people: ['Alex'],
    })
    expect(validateOverviewSearch({ month: 'October' }).month).toBeUndefined()

    expect(
      validatePlanSearch({ tab: 'bills', people: ['Alex'] }),
    ).toMatchObject({
      tab: 'bills',
      people: ['Alex'],
    })
    expect(validatePlanSearch({ tab: 'rules' }).tab).toBeUndefined()

    expect(validateAccountsSearch({ tab: 'rules' }).tab).toBe('rules')
    expect(validateAccountsSearch({ tab: 'updates' }).tab).toBe('updates')
    expect(validateAccountsSearch({ tab: 'bills' }).tab).toBeUndefined()

    expect(validateSpendingSearch({ period: '6' }).period).toBe('6')
    expect(validateSpendingSearch({ period: 12 }).period).toBe('12')
    expect(validateSpendingSearch({ period: 'month' }).period).toBe('month')
    expect(validateSpendingSearch({ period: 'nope' }).period).toBeUndefined()
    expect(validateSpendingSearch({ month: '2026-10' }).month).toBe('2026-10')
  })

  it('carries only the Lens between screens, and a jump can set the tab it lands on', () => {
    expect(
      keepLens({ people: ['Alex'], tab: 'bills', month: '2026-10' }),
    ).toEqual({ people: ['Alex'] })

    const staying = withLensSearch(
      '/accounts',
      { people: ['Alex'], tab: 'updates', month: '2026-10' },
      { people: ['Alex'] },
      '/accounts',
      { tab: 'rules' },
    )
    expect(staying.people).toEqual(['Alex'])
    expect(staying.tab).toBe('rules')
    expect(staying.month).toBe('2026-10')
    expect(staying.accounts).toBeUndefined()

    const leaving = withLensSearch(
      '/spending',
      { people: ['Alex'], period: '6', q: 'kroger' },
      { people: ['Alex'], q: 'kroger' },
      '/plan',
      { tab: 'bills' },
    )
    expect(leaving).toMatchObject({
      people: ['Alex'],
      q: 'kroger',
      tab: 'bills',
    })
    expect(leaving.period).toBeUndefined()
  })
})
