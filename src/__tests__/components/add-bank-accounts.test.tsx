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
import { ledger } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import {
  AddBankAccounts,
  unlinkedBankAccounts,
} from '@/components/accounts/AddBankAccounts'

const mocks = vi.hoisted(() => ({ add: vi.fn() }))
const ix = indexLedger(ledger())
vi.mock('@/lib/ledger/book', () => ({ useBook: () => ({ ix }) }))
vi.mock('@/lib/updates/server', () => ({ addFromBank: mocks.add }))
vi.mock('@/lib/ledger/useLedger', () => ({ LEDGER_KEY: ['ledger'] }))
vi.mock('@/lib/households/useHousehold', () => ({
  useHousehold: () => ({ data: undefined }),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const bank = (providerId: string, name: string, over = {}) => ({
  connectionId: 'c1',
  providerId,
  name,
  institution: 'Chase',
  currency: 'USD',
  account: null,
  present: true,
  syncedThrough: null,
  historyFrom: null,
  historyComplete: false,
  problem: null,
  problemKind: null,
  ...over,
})

function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  )
}

describe('Add these accounts', () => {
  it('offers only bank accounts that could be linked', () => {
    expect(
      unlinkedBankAccounts([
        bank('p1', 'Visa'),
        bank('p2', 'Linked', { account: 'Card' }),
        bank('p3', 'Gone', { present: false }),
        bank('p4', 'Euro', { currency: 'EUR' }),
      ]).map((b) => b.name),
    ).toEqual(['Visa'])
  })

  it('adds each as a new account with a guessed kind, unless skipped', async () => {
    mocks.add.mockResolvedValue({ added: 1, linked: 1 })
    const onDone = vi.fn()
    mount(
      <AddBankAccounts
        banks={[bank('p1', 'Sapphire Visa'), bank('p2', 'Total Checking')]}
        onDone={onDone}
      />,
    )
    fireEvent.change(screen.getByLabelText('Name for Sapphire Visa'), {
      target: { value: 'Sapphire' },
    })
    const skip = screen
      .getByRole('radiogroup', { name: 'What to do with Total Checking' })
      .querySelectorAll('button')[2]
    fireEvent.click(skip)
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 account' }))
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith({
        data: {
          choices: [
            {
              connectionId: 'c1',
              providerId: 'p1',
              create: {
                name: 'Sapphire',
                kind: 'credit',
                owner: 'Joint',
                institution: 'Chase',
              },
            },
          ],
        },
      }),
    )
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('won’t add one under a name already used', () => {
    mount(<AddBankAccounts banks={[bank('p1', ix.ledger.accounts[0].name)]} />)
    expect(screen.getByRole('alert').textContent).toMatch(/not already used/)
    expect(
      (
        screen.getByRole('button', {
          name: 'Add 1 account',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})
