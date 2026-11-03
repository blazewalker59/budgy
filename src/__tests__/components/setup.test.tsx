// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { ledger, paySchedule, txn } from '@test/factories'
import type { Ledger } from '@/lib/model/types'
import { buildBook } from '@/lib/model/book'
import { SetupChecklist } from '@/components/setup/SetupChecklist'
import { SetupScreen } from '@/components/setup/SetupScreen'

const TODAY = '2026-11-02'
const mocks = vi.hoisted(() => ({
  setup: vi.fn(),
  setTargets: vi.fn(),
  navigate: vi.fn(),
  book: null as unknown,
}))
vi.mock('@/lib/ledger/book', () => ({ useBook: () => mocks.book }))
vi.mock('@/lib/ledger/useLedger', () => ({
  useSetup: () => ({ mutate: mocks.setup }),
  useSetTargets: () => ({ mutate: mocks.setTargets, isPending: false }),
  useHideCategory: () => ({ mutate: vi.fn() }),
  useRenameCategory: () => ({ mutate: vi.fn() }),
  useSession: () => ({
    data: {
      status: 'member',
      household: { owners: ['Joint', 'Sam'] },
    },
  }),
}))
vi.mock('@/lib/households/useHousehold', () => ({
  useHousehold: () => ({
    data: {
      household: {
        id: 'hh',
        name: 'Ours',
        role: 'owner',
        timeZone: 'UTC',
        owners: ['Joint', 'Sam'],
      },
      members: [{ id: 'me' }],
      invites: [],
    },
  }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    search,
    to,
  }: {
    children: React.ReactNode
    search?: { step?: string }
    to: string
  }) => (
    <a href={`${to}${search?.step ? `?step=${search.step}` : ''}`}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate,
}))
// Steps not under test here render nothing.
vi.mock('@/components/households/HouseholdSettings', () => ({
  HouseholdSettings: () => null,
}))
vi.mock('@/components/households/HouseholdScreen', () => ({
  InviteForm: () => null,
}))
vi.mock('@/components/accounts/BankConnections', () => ({
  BankConnections: () => null,
  SimplefinNote: () => null,
}))
vi.mock('@/components/accounts/BankCategories', () => ({
  BankCategories: () => null,
}))
vi.mock('@/components/budget/PaySheet', () => ({ PaySheet: () => null }))

function useLedger(l: Ledger) {
  mocks.book = buildBook(l, TODAY)
}
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Finish setup on Overview', () => {
  it('shows each step done or not, as the Ledger has it', () => {
    useLedger(ledger({ pay: [paySchedule()] }))
    render(<SetupChecklist />)
    const list = screen.getByRole('list')
    expect(within(list).getByText('Your Household').textContent).toContain(
      '(done)',
    )
    expect(within(list).getByText('Add your pay').textContent).toContain(
      '(done)',
    )
    expect(within(list).getByText('Set Targets').textContent).not.toContain(
      '(done)',
    )
    expect(screen.getByText(/3 of 9 done/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Next: Invite your partner' }),
    ).toHaveProperty('href', expect.stringContaining('?step=partner'))
    fireEvent.click(screen.getByRole('button', { name: 'Put setup away' }))
    expect(mocks.setup).toHaveBeenCalledWith({ dismissed: true })
  })

  it('stays away once put away', () => {
    useLedger(ledger({ setup: { skipped: [], done: [], dismissed: true } }))
    const { container } = render(<SetupChecklist />)
    expect(container.textContent).toBe('')
  })
})

describe('Setup', () => {
  it('opens the first step not done, and skips along', () => {
    useLedger(ledger())
    render(<SetupScreen />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Invite your partner',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(mocks.setup).toHaveBeenCalledWith({
      step: 'partner',
      mark: 'skipped',
    })
    expect(mocks.navigate).toHaveBeenCalledWith({
      search: { step: 'categories' },
    })
  })

  it('counts Categories reviewed once the Member moves on', () => {
    useLedger(ledger())
    render(<SetupScreen step="categories" />)
    expect(screen.getByLabelText('Use Tithe')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(mocks.setup).toHaveBeenCalledWith({
      step: 'categories',
      mark: 'done',
    })
  })

  it('starts each Target at its typical month and saves them all', () => {
    useLedger(
      ledger({
        txns: ['2026-08-05', '2026-09-05', '2026-10-05'].map((date) =>
          txn({ date, sourceCategory: 'Groceries', amount: 41_000 }),
        ),
      }),
    )
    render(<SetupScreen step="targets" />)
    const groceries = screen.getByLabelText(
      'Target for Groceries',
    ) as HTMLInputElement
    expect(groceries.value).toBe('410')
    fireEvent.change(groceries, { target: { value: '450' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 Target' }))
    expect(mocks.setTargets).toHaveBeenCalledWith({
      startsMonth: '2026-11',
      targets: [{ category: 'Groceries', amount: 45_000 }],
    })
  })

  it('says so when there’s no history to start Targets from', () => {
    useLedger(ledger())
    render(<SetupScreen step="targets" />)
    expect(screen.getByText(/no spending history yet/)).toBeTruthy()
    expect(
      (screen.getByLabelText('Target for Groceries') as HTMLInputElement).value,
    ).toBe('')
    expect(
      (
        screen.getByRole('button', {
          name: 'Save Targets',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('finishes back on Overview', () => {
    useLedger(ledger())
    render(<SetupScreen step="bills" />)
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/', search: {} })
  })
})
