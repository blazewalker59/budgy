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
import { AccountUpdates } from '@/components/accounts/AccountUpdates'

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/updates/server', () => ({
  getAccountUpdates: mocks.get,
  updateAccountExport: mocks.update,
}))
vi.mock('@/lib/ledger/useLedger', () => ({
  LEDGER_KEY: ['ledger'],
  useSession: () => ({
    data: {
      status: 'member',
      member: { id: 'member' },
      household: { id: 'hh_test' },
    },
  }),
}))
vi.mock('@/lib/ledger/book', () => ({
  useBook: () => ({
    ix: {
      ledger: {
        accounts: [
          { name: 'Card', owner: 'Joint', kind: 'credit', closed: false },
        ],
      },
    },
  }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/spending">{children}</a>
  ),
}))

const clients: Array<QueryClient> = []
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <AccountUpdates />
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  vi.resetAllMocks()
})
const empty = {
  account: 'Card',
  format: null,
  latest: null,
  success: null,
  lockExpiresAt: null,
}
const summary = {
  account: 'Card',
  added: 0,
  updated: 0,
  linked: 0,
  replaced: 0,
  alreadyHad: 1,
  duplicates: [],
  notSpending: 0,
  carried: 0,
  review: [],
  filed: [],
}
const csv =
  'Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD)\n10/01/2026,10/02/2026,Shop,Shop,Shopping,Purchase,5'

describe('Unified Account Updates UI', () => {
  it('shows the actual manual method and does not claim a bank connection or use a purchase date as update status', async () => {
    mocks.get.mockResolvedValue([empty])
    mount()
    expect(await screen.findByText('Card')).toBeTruthy()
    expect(screen.getByText(/No update receipt yet/)).toBeTruthy()
    expect(screen.getByText(/aren’t connected yet/)).toBeTruthy()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('requires review then confirmation, without a known balance, and confirms a zero-new-purchase update', async () => {
    mocks.get.mockResolvedValue([empty])
    mocks.update.mockResolvedValue({
      summary,
      excluded: 0,
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
      total: 1,
    })
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Update Account' }),
    )
    const file = new File([csv], 'apple.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) })
    fireEvent.change(screen.getByLabelText('Choose transactions CSV'), {
      target: { files: [file] },
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Export format')).toHaveProperty(
        'value',
        'apple-card',
      ),
    )
    expect(screen.queryByLabelText('A balance you know')).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Review export' }))
    const confirm = await screen.findByRole('button', {
      name: 'Confirm update',
    })
    expect(mocks.update).toHaveBeenCalledWith({
      data: { account: 'Card', text: csv, format: 'apple-card', commit: false },
    })
    fireEvent.click(confirm)
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      expect.stringContaining('0 added'),
    )
    expect(mocks.update).toHaveBeenCalledWith({
      data: { account: 'Card', text: csv, format: 'apple-card', commit: true },
    })
  })

  it('does not silently choose an amount sign for a generic bank export', async () => {
    mocks.get.mockResolvedValue([empty])
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Update Account' }),
    )
    const generic = 'Date,Description,Amount\n2026-10-01,Shop,-5'
    const file = new File([generic], 'bank.csv')
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve(generic),
    })
    fireEvent.change(screen.getByLabelText('Choose transactions CSV'), {
      target: { files: [file] },
    })
    const review = await screen.findByRole('button', { name: 'Review export' })
    expect((review as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Export format'), {
      target: { value: 'money-out-negative' },
    })
    expect((review as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a failed attempt without hiding the last successful update', async () => {
    const receipt = {
      id: 'ok',
      source: 'uploaded',
      status: 'succeeded',
      startedAt: new Date('2026-10-01'),
      finishedAt: new Date('2026-10-01'),
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      added: 0,
      updated: 0,
      linked: 0,
      skipped: 2,
      review: 0,
      issues: [],
      message: null,
    }
    mocks.get.mockResolvedValue([
      {
        ...empty,
        success: receipt,
        latest: {
          ...receipt,
          id: 'failed',
          status: 'failed',
          message: 'This update did not finish.',
        },
      },
    ])
    mount()
    expect(await screen.findByText(/^Last updated /)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(
      'last successful update is shown above',
    )
  })
})
