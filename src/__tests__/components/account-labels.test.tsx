// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { ledger } from '../_setup/factories'
import type { Account, Ledger } from '@/lib/model/types'
import { BookProvider } from '@/lib/ledger/book'
import { AccountsScreen } from '@/components/accounts/AccountsScreen'
import { AccountSheet } from '@/components/accounts/AccountSheet'

const mocks = vi.hoisted(() => ({
  saveAccount: vi.fn(),
  addLabel: vi.fn(),
  changeLabel: vi.fn(),
  deleteLabel: vi.fn(),
  labelAccounts: vi.fn(),
}))
const edit = (mutate: (v: unknown) => unknown = () => {}) => ({
  mutate,
  mutateAsync: (v: unknown) => Promise.resolve(mutate(v)),
})
vi.mock('@/lib/ledger/useLedger', () => ({
  LEDGER_KEY: ['ledger'],
  useSaveAccount: () => edit(mocks.saveAccount),
  useAddLabel: () => edit(mocks.addLabel),
  useChangeLabel: () => edit(mocks.changeLabel),
  useDeleteLabel: () => edit(mocks.deleteLabel),
  useLabelAccounts: () => edit(mocks.labelAccounts),
  useDeleteAccount: () => edit(),
  useDeleteBalance: () => edit(),
  useRecordBalances: () => edit(),
  useRemoveStarting: () => edit(),
  useWorthBaseline: () => edit(),
}))
vi.mock('@/lib/ledger/server', () => ({ uploadPurchases: vi.fn() }))
vi.mock('@/lib/updates/useUpdates', () => ({ UPDATES_KEY: ['updates'] }))
vi.mock('@/lib/households/useHousehold', () => ({
  useHousehold: () => ({ data: undefined }),
}))
vi.mock('@/components/lens/LensBar', () => ({ LensBar: () => null }))
vi.mock('@/components/charts/lazy', () => ({ WorthChart: () => null }))
vi.mock('@/components/accounts/AccountUpdates', () => ({
  AccountUpdates: () => null,
}))
vi.mock('@/components/accounts/RulesTab', () => ({ RulesTab: () => null }))
vi.mock('@/components/accounts/MoneyInTab', () => ({ MoneyInTab: () => null }))
vi.mock('@/components/accounts/Duplicates', () => ({
  Duplicates: () => null,
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

const acct = (name: string, over: Partial<Account> = {}): Account => ({
  name,
  sourceName: name,
  owner: 'Joint',
  kind: 'education',
  institution: null,
  closed: false,
  securedBy: null,
  label: null,
  displayName: null,
  ...over,
})

function book(over: Partial<Ledger> = {}) {
  return ledger({
    accounts: [
      acct('Addie 529', { label: 'Addie', displayName: '529' }),
      acct('Addie Trump Account'),
      acct('Addie’s Savings', { kind: 'savings' }),
      acct('Asher 529'),
    ],
    labels: [
      { name: 'Addie', color: 'pink' },
      { name: 'Asher', color: 'blue' },
    ],
    ...over,
  })
}

function mount(node: React.ReactNode, l: Ledger = book()) {
  return render(
    <BookProvider ledger={l} timeZone="America/New_York">
      {node}
    </BookProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Accounts list', () => {
  it('names a labelled Account by its chip and short name, its full name spoken', () => {
    mount(<AccountsScreen lens={{}} tab="accounts" />)
    const row = screen.getByRole('button', { name: /^Addie 529/ })
    const chip = within(row).getByText('Addie')
    expect(chip.className).toContain('bg-[var(--label-bg)]')
    expect(chip.getAttribute('style')).toContain('--label-bg: #fce7f3')
    expect(within(row).getByText('529')).toBeTruthy()
    expect(row.querySelector('[title="Addie 529"]')).toBeTruthy()
    // Without a label or Shown as, just the name.
    const plain = screen.getByRole('button', { name: /^Asher 529/ })
    expect(plain.querySelector('.sr-only')).toBeNull()
  })
})

describe('Account sheet', () => {
  it('heads a labelled Account with its chip, short name and full name', () => {
    mount(<AccountSheet name="Addie 529" onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Addie 529' })
    const header = dialog.querySelector('.text-base.font-bold')!
    expect(header.textContent).toBe('Addie529Addie 529Addie 529')
    expect(
      within(dialog).getByRole('button', { name: 'Label: Addie' }),
    ).toBeTruthy()
    expect(
      (within(dialog).getByLabelText('Shown as') as HTMLInputElement).value,
    ).toBe('529')
  })

  it('suggests Shown as from a chosen label, and offers it to the others', () => {
    mount(<AccountSheet name="Addie Trump Account" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Label: none' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Addie' }))
    expect(mocks.saveAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Addie Trump Account',
        label: 'Addie',
        displayName: 'Trump Account',
        isNew: false,
      }),
    )
    expect((screen.getByLabelText('Shown as') as HTMLInputElement).value).toBe(
      'Trump Account',
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Also label 1 other account starting with Addie',
      }),
    )
    expect(mocks.labelAccounts).toHaveBeenCalledWith({
      label: 'Addie',
      accounts: [{ name: 'Addie’s Savings', displayName: 'Savings' }],
    })
  })

  it('makes a new label with a colour, then gives it to the Account', async () => {
    mount(<AccountSheet name="Asher 529" onClose={() => {}} />, {
      ...book(),
      labels: [{ name: 'Addie', color: 'pink' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Label: none' }))
    fireEvent.change(screen.getByLabelText('New label'), {
      target: { value: 'Asher' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Violet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(mocks.addLabel).toHaveBeenCalledWith({
      name: 'Asher',
      color: 'violet',
    })
    await waitFor(() =>
      expect(mocks.saveAccount).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Asher', displayName: '529' }),
      ),
    )
  })

  it('won’t make a label whose name is taken in any case', () => {
    mount(<AccountSheet name="Asher 529" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Label: none' }))
    fireEvent.change(screen.getByLabelText('New label'), {
      target: { value: 'asher' },
    })
    expect(
      screen.getByText('There’s already a label called asher.'),
    ).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('renames, recolours and deletes labels, saying how many Accounts use one', () => {
    mount(<AccountSheet name="Asher 529" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Label: none' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage labels' }))
    const rename = screen.getByLabelText('Rename Addie')
    fireEvent.change(rename, { target: { value: 'Adelaide' } })
    fireEvent.blur(rename)
    expect(mocks.changeLabel).toHaveBeenCalledWith({
      from: 'Addie',
      name: 'Adelaide',
      color: 'pink',
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Asher’s colour: Blue' }),
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }))
    expect(mocks.changeLabel).toHaveBeenCalledWith({
      from: 'Asher',
      name: 'Asher',
      color: 'green',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Addie' }))
    const ask = screen.getByRole('alertdialog', {
      name: 'Delete the label Addie?',
    })
    expect(ask.textContent).toContain('1 account uses it (Addie 529)')
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }))
    expect(mocks.deleteLabel).toHaveBeenCalledWith({ name: 'Addie' })
  })

  it('clears the label, keeping Shown as', () => {
    mount(<AccountSheet name="Addie 529" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Label: Addie' }))
    fireEvent.click(screen.getByRole('radio', { name: 'None' }))
    const saved = mocks.saveAccount.mock.calls[0][0] as Account
    expect(saved.label).toBeNull()
    expect(saved).not.toHaveProperty('displayName')
  })

  it('leaves the label alone when other details change', () => {
    mount(<AccountSheet name="Addie 529" onClose={() => {}} />)
    const institution = screen.getByLabelText('Institution')
    fireEvent.change(institution, { target: { value: 'Path2College' } })
    fireEvent.blur(institution)
    const saved = mocks.saveAccount.mock.calls[0][0] as Account
    expect(saved.institution).toBe('Path2College')
    expect(saved).not.toHaveProperty('label')
    expect(saved).not.toHaveProperty('displayName')
  })
})
