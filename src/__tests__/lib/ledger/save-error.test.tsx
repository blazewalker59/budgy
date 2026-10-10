// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { txn } from '../../_setup/factories'
import type { Ledger } from '@/lib/model/types'
import { LedgerSaveError } from '@/components/shared/LedgerSaveError'
import {
  LEDGER_KEY,
  SESSION_KEY,
  clearSaveError,
  useLedgerQuery,
  useMoveTxn,
} from '@/lib/ledger/useLedger'

const mocks = vi.hoisted(() => ({
  moveTxn: vi.fn(),
  getLedger: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('@/lib/ledger/server', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    moveTxn: mocks.moveTxn,
    getLedger: mocks.getLedger,
    getSession: mocks.getSession,
  }
})

const session = {
  status: 'member' as const,
  member: {
    id: 'm',
    name: 'Sam',
    email: 'sam@example.com',
    image: null,
    emailVerified: true,
  },
  household: {
    id: 'h',
    name: 'Friends',
    role: 'owner' as const,
    timeZone: 'America/New_York',
    owners: ['Joint', 'Sam'],
  },
}

function ledger(category: string | null): Ledger {
  return {
    categories: [],
    accounts: [],
    txns: [txn({ id: 't1', category })],
    pay: [],
    balances: [],
    lenses: [],
    rules: [],
    targets: [],
    plans: [],
    kept: [],
    baseline: null,
  }
}

function Probe() {
  const query = useLedgerQuery(true)
  const move = useMoveTxn()
  const category = query.data?.txns[0]?.category ?? 'unset'
  return (
    <div>
      <p>category:{category}</p>
      <button
        type="button"
        onClick={() => move.mutate({ id: 't1', category: 'Food' })}
      >
        Save
      </button>
      <LedgerSaveError />
    </div>
  )
}

afterEach(() => {
  cleanup()
  clearSaveError()
  vi.clearAllMocks()
})

describe('failed Ledger saves', () => {
  it('refetches the server Ledger and shows the error', async () => {
    const server = ledger('Groceries')
    mocks.getLedger.mockResolvedValue(server)
    mocks.moveTxn.mockRejectedValue(new Error('Database is busy'))
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    client.setQueryData(SESSION_KEY, session)
    client.setQueryData([...LEDGER_KEY, 'm', 'h'], ledger(null))
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
    expect(screen.getByText('category:unset')).toBeTruthy()
    const before = mocks.getLedger.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Database is busy',
    )
    await waitFor(() =>
      expect(screen.getByText('category:Groceries')).toBeTruthy(),
    )
    expect(mocks.getLedger.mock.calls.length).toBeGreaterThan(before)
    expect(screen.queryByText('category:Food')).toBeNull()
  })

  it('hides database text and lets the Member dismiss the alert', async () => {
    mocks.getLedger.mockResolvedValue(ledger(null))
    mocks.moveTxn.mockRejectedValue(new Error('Failed query: select secret'))
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    client.setQueryData(SESSION_KEY, session)
    client.setQueryData([...LEDGER_KEY, 'm', 'h'], ledger(null))
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t save. Try again.')
    expect(alert.textContent).not.toContain('secret')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
