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
import { EXPORT_LABELS } from '@/lib/updates/exports'

// A touch screen: each Dropdown opens a sheet of plain option buttons.
window.matchMedia = ((query: string) => ({
  matches: query === '(pointer: coarse)',
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

/** Choose an option from a Dropdown, as a person would. */
function pick(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  tokens: vi.fn(),
  createToken: vi.fn(),
  connections: vi.fn(),
  link: vi.fn(),
  accounts: [
    { name: 'Card', owner: 'Joint', kind: 'credit', closed: false },
  ] as Array<{ name: string; owner: string; kind: string; closed: boolean }>,
}))
vi.mock('@/lib/updates/server', () => ({
  getAccountUpdates: mocks.get,
  updateAccountExport: mocks.update,
  getUploadTokens: mocks.tokens,
  createAccountUploadToken: mocks.createToken,
  revokeAccountUploadToken: vi.fn(),
  getBankConnections: mocks.connections,
  connectBank: vi.fn(),
  refreshBankAccounts: vi.fn(),
  linkBankAccount: mocks.link,
  disconnectBank: vi.fn(),
  syncBank: vi.fn(),
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
        accounts: mocks.accounts,
        balances: [],
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
  if (!mocks.tokens.getMockImplementation()) mocks.tokens.mockResolvedValue([])
  if (!mocks.connections.getMockImplementation())
    mocks.connections.mockResolvedValue([])
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
    expect(screen.getByText(/Not set up yet/)).toBeTruthy()
    await waitFor(() => expect(mocks.connections).toHaveBeenCalled())
    expect(screen.queryByText(/Connected by/)).toBeNull()
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
      await screen.findByRole('button', { name: 'Set up updates' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Upload a file now/ }))
    const file = new File([csv], 'apple.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) })
    fireEvent.change(screen.getByLabelText('Choose transactions CSV'), {
      target: { files: [file] },
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Export format').textContent).toBe(
        EXPORT_LABELS['apple-card'],
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
      await screen.findByRole('button', { name: 'Set up updates' }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Upload a file now/ }))
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
    pick('Export format', EXPORT_LABELS['money-out-negative'])
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
  it('shows a new Shortcut token once, bound to its Account and format', async () => {
    mocks.get.mockResolvedValue([empty])
    mocks.createToken.mockResolvedValue({
      id: 't1',
      token: 'bu_secret',
      account: 'Card',
    })
    mount()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Set up updates' }),
    )
    // No bank to link: for a card, the share sheet is the recommended way.
    const shortcut = screen.getByRole('button', {
      name: /From your iPhone’s share sheet/,
    })
    expect(shortcut.textContent).toContain('Recommended')
    fireEvent.click(shortcut)
    expect(screen.getByLabelText('The export it will send').textContent).toBe(
      EXPORT_LABELS['apple-card'],
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Shortcut token' }),
    )
    expect(await screen.findByText('Bearer bu_secret')).toBeTruthy()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy header value' }))
    expect(writeText).toHaveBeenCalledWith('Bearer bu_secret')
    expect(await screen.findByText('Copied')).toBeTruthy()
    expect(mocks.createToken).toHaveBeenCalledWith({
      data: { account: 'Card', format: 'apple-card' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Bearer bu_secret')).toBeNull()
  })

  it('links a bank account from its Budgy Account, with connections collapsed', async () => {
    mocks.get.mockResolvedValue([empty])
    mocks.connections.mockResolvedValue([
      {
        id: 'c1',
        name: 'SimpleFIN',
        createdBy: 'me@example.com',
        status: 'attention',
        lastError: 'SimpleFIN says: Vanguard needs attention.',
        lastFetchedAt: null,
        createdAt: new Date('2026-10-01'),
        accounts: [
          {
            connectionId: 'c1',
            providerId: 'p1',
            name: 'Sapphire',
            institution: 'Chase',
            currency: 'USD',
            account: null,
            present: true,
            syncedThrough: null,
          },
        ],
      },
    ])
    mocks.link.mockResolvedValue(undefined)
    mount()
    expect(
      await screen.findByText(/SimpleFIN · 0 of 1 accounts linked/),
    ).toBeTruthy()
    expect(screen.getByText(/needs attention/)).toBeTruthy()
    // Collapsed: the connection's details aren't shown until opened.
    expect(screen.queryByText(/Vanguard needs attention/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Set up updates' }))
    const fromBank = screen.getByRole('button', {
      name: /Automatically from your bank/,
    })
    expect(fromBank.textContent).toContain('Recommended')
    fireEvent.click(fromBank)
    expect(
      screen.getByLabelText('SimpleFIN account for Card').textContent,
    ).toBe('Not linked')
    expect(mocks.link).not.toHaveBeenCalled()
    pick('SimpleFIN account for Card', 'Sapphire · Chase')
    await waitFor(() =>
      expect(mocks.link).toHaveBeenCalledWith({
        data: { connectionId: 'c1', providerId: 'p1', account: 'Card' },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /Bank connections/ }))
    expect(screen.getByText(/Vanguard needs attention/)).toBeTruthy()
    expect(screen.getByText(/Not linked yet: Sapphire \(Chase\)/)).toBeTruthy()
  })
  it('puts Accounts needing action above those already set up, and keeps an open card in place', async () => {
    mocks.accounts.push(
      { name: 'Checking', owner: 'Joint', kind: 'checking', closed: false },
      { name: 'Apple', owner: 'Joint', kind: 'credit', closed: false },
    )
    try {
      mocks.get.mockResolvedValue([
        empty,
        { ...empty, account: 'Checking' },
        { ...empty, account: 'Apple' },
      ])
      mocks.tokens.mockResolvedValue([{ id: 't', account: 'Apple' }])
      mocks.connections.mockResolvedValue([
        {
          id: 'c1',
          name: 'SimpleFIN',
          createdBy: 'me@example.com',
          status: 'ready',
          lastError: null,
          lastFetchedAt: null,
          createdAt: new Date('2026-10-01'),
          accounts: [
            {
              connectionId: 'c1',
              providerId: 'p1',
              name: 'Joint Checking',
              institution: 'Peach State',
              currency: 'USD',
              account: 'Checking',
              present: true,
              syncedThrough: '2026-10-09',
            },
          ],
        },
      ])
      mount()
      const needs = (await screen.findByText(/Needs action · 1/)).parentElement!
      const done = screen.getByText(/Set up · 2/).parentElement!
      expect(needs.textContent).toContain('Card')
      expect(done.textContent).toContain('Checking')
      expect(done.textContent).toContain('Apple')
      expect(done.textContent).toContain(
        'Updates automatically from Joint Checking',
      )

      // Setting up a Shortcut for Card: it stays put until closed.
      mocks.createToken.mockResolvedValue({
        id: 't2',
        token: 'bu_new',
        account: 'Card',
      })
      fireEvent.click(screen.getByRole('button', { name: 'Set up updates' }))
      fireEvent.click(
        screen.getByRole('button', { name: /From your iPhone’s share sheet/ }),
      )
      mocks.tokens.mockResolvedValue([
        { id: 't', account: 'Apple' },
        { id: 't2', account: 'Card' },
      ])
      fireEvent.click(
        screen.getByRole('button', { name: 'Create Shortcut token' }),
      )
      expect(await screen.findByText('Bearer bu_new')).toBeTruthy()
      expect(screen.getByText(/Needs action · 1/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(await screen.findByText('All set up')).toBeTruthy()
      expect(screen.queryByText(/Needs action/)).toBeNull()
    } finally {
      mocks.accounts.splice(1)
    }
  })
})
