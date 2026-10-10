// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CommandPalette } from '@/components/lens/CommandPalette'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  loc: {
    pathname: '/spending',
    search: { people: ['Alex'], period: '6', q: 'kroger' } as Record<
      string,
      unknown
    >,
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({
    select,
  }: {
    select: (s: {
      location: { pathname: string; search: Record<string, unknown> }
    }) => unknown
  }) => select({ location: mocks.loc }),
}))

vi.mock('@/lib/ledger/book', async () => {
  const { indexLedger } = await import('@/lib/model/ledger')
  const { ledger } = await import('@test/factories')
  const ix = indexLedger(ledger())
  const plannedIds = new Set<string>()
  return {
    useBook: () => ({
      ix,
      today: '2026-10-08',
      plannedIds,
    }),
  }
})

function open(query: string) {
  fireEvent.click(screen.getByRole('button', { name: /Search or filter/ }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
}

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  window.scrollTo = () => {}
})

afterEach(() => {
  cleanup()
  mocks.navigate.mockClear()
  mocks.loc.pathname = '/spending'
  mocks.loc.search = { people: ['Alex'], period: '6', q: 'kroger' }
})

describe('Command palette destinations', () => {
  it('opens Planned bills and Store Rules on their real screens, with the filter', () => {
    render(<CommandPalette />)
    open('planned bills')
    fireEvent.click(screen.getByRole('option', { name: 'Planned bills' }))
    const bills = mocks.navigate.mock.calls.at(-1)?.[0]
    expect(bills.to).toBe('/plan')
    expect(bills.search.tab).toBe('bills')
    expect(bills.search.people).toEqual(['Alex'])
    expect(bills.search.q).toBe('kroger')
    expect(bills.search.period).toBeUndefined()

    mocks.loc.pathname = '/accounts'
    mocks.loc.search = { people: ['Alex'], tab: 'updates', month: '2026-10' }
    cleanup()
    render(<CommandPalette />)
    open('store rules')
    fireEvent.click(screen.getByRole('option', { name: 'Store Rules' }))
    const rules = mocks.navigate.mock.calls.at(-1)?.[0]
    expect(rules.to).toBe('/accounts')
    expect(rules.search.tab).toBe('rules')
    expect(rules.search.people).toEqual(['Alex'])
    expect(rules.search.month).toBe('2026-10')
  })

  it('still carries the filter onto Spending, and Agents stays a plain route', () => {
    render(<CommandPalette />)
    open('spending')
    fireEvent.click(screen.getByRole('option', { name: /^Spending/ }))
    const spending = mocks.navigate.mock.calls.at(-1)?.[0]
    expect(spending.to).toBe('/spending')
    expect(spending.search.people).toEqual(['Alex'])
    expect(spending.search.period).toBe('6')

    open('agents')
    fireEvent.click(screen.getByRole('option', { name: /^Agents/ }))
    expect(mocks.navigate).toHaveBeenLastCalledWith({ to: '/agents' })
  })
})
