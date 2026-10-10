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
import type { SessionState } from '@/lib/auth/session'
import { Onboarding } from '@/components/households/Onboarding'
import { JoinHousehold } from '@/components/households/JoinHousehold'
import { HouseholdScreen } from '@/components/households/HouseholdScreen'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  preview: vi.fn(),
  join: vi.fn(),
  invite: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  transfer: vi.fn(),
  details: vi.fn(),
  session: null as SessionState | null,
}))
vi.mock('@/lib/households/server', () => ({
  startHousehold: mocks.start,
  getHouseholdInvite: mocks.preview,
  joinHousehold: mocks.join,
  inviteToHousehold: mocks.invite,
  cancelHouseholdInvite: mocks.cancel,
  removeHouseholdMember: mocks.remove,
  transferHouseholdOwnership: mocks.transfer,
  getHousehold: mocks.details,
}))
vi.mock('@/lib/ledger/useLedger', () => ({
  SESSION_KEY: ['session'],
  useSession: () => ({ data: mocks.session }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}))
vi.mock('@/lib/auth/client', () => ({ signOut: vi.fn() }))

const person = {
  id: 'alice',
  name: 'Alice',
  email: 'alice@example.com',
  image: null,
  emailVerified: true,
}
const household = { id: 'hh_test', name: 'Our budget', role: 'owner' as const }
const clients: Array<QueryClient> = []
function mount(component: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>{component}</QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  vi.resetAllMocks()
  mocks.session = null
})

describe('Household onboarding', () => {
  it('requires a name, explains privacy, and submits creation only on request', async () => {
    mocks.start.mockReturnValue(new Promise(() => {}))
    mount(<Onboarding member={person} />)
    expect(screen.getByText(/Only your Household can see/)).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: 'Create Household',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.change(screen.getByLabelText('Household name'), {
      target: { value: 'Alice and Bob' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Household' }))
    await waitFor(() =>
      expect(mocks.start).toHaveBeenCalledWith({
        data: { name: 'Alice and Bob' },
      }),
    )
  })

  it('shows creation errors without losing the entered name', async () => {
    mocks.start.mockRejectedValue(
      new Error('You already belong to a Household'),
    )
    mount(<Onboarding member={person} />)
    fireEvent.change(screen.getByLabelText('Household name'), {
      target: { value: 'My budget' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create Household' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'You already belong to a Household',
    )
    expect(
      (screen.getByLabelText('Household name') as HTMLInputElement).value,
    ).toBe('My budget')
  })
})

describe('Invitation acceptance', () => {
  it('shows the matching Household but does not automatically accept', async () => {
    mocks.session = { status: 'no-household', member: person }
    mocks.preview.mockResolvedValue({
      householdId: 'hh_other',
      name: 'Shared budget',
    })
    mocks.join.mockReturnValue(new Promise(() => {}))
    mount(<JoinHousehold token={'a'.repeat(43)} />)
    const button = await screen.findByRole('button', {
      name: 'Accept invitation',
    })
    expect(mocks.join).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() =>
      expect(mocks.join).toHaveBeenCalledWith({
        data: { token: 'a'.repeat(43) },
      }),
    )
  })

  it('does not offer acceptance when the recipient already has a Household', async () => {
    mocks.session = { status: 'member', member: person, household }
    mocks.preview.mockResolvedValue({
      householdId: 'hh_other',
      name: 'Other budget',
    })
    mount(<JoinHousehold token={'a'.repeat(43)} />)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('won’t replace or merge'),
    )
    expect(
      screen.queryByRole('button', { name: 'Accept invitation' }),
    ).toBeNull()
  })

  it('explains a wrong-email or expired link without disclosing Household details', async () => {
    mocks.session = { status: 'no-household', member: person }
    mocks.preview.mockRejectedValue(
      new Error('Invitation is unavailable or belongs to another email'),
    )
    mount(<JoinHousehold token={'a'.repeat(43)} />)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('invited Google account'),
    )
    expect(
      screen.queryByRole('button', { name: 'Accept invitation' }),
    ).toBeNull()
    expect(mocks.join).not.toHaveBeenCalled()
  })
})

describe('Household management', () => {
  it('shows membership but hides owner actions from Members', async () => {
    mocks.session = {
      status: 'member',
      member: person,
      household: { ...household, role: 'member' },
    }
    mocks.details.mockResolvedValue({
      household: { ...household, role: 'member' },
      members: [
        { id: person.id, name: 'Alice', email: person.email, role: 'member' },
        { id: 'bob', name: 'Bob', email: 'bob@example.com', role: 'owner' },
      ],
      invites: [],
    })
    mount(<HouseholdScreen />)
    expect(await screen.findByText('Bob')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Create invite link' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('asks for confirmation before removing a Member', async () => {
    mocks.session = { status: 'member', member: person, household }
    mocks.details.mockResolvedValue({
      household,
      members: [
        { id: person.id, name: 'Alice', email: person.email, role: 'owner' },
        { id: 'bob', name: 'Bob', email: 'bob@example.com', role: 'member' },
      ],
      invites: [],
    })
    mocks.remove.mockReturnValue(new Promise(() => {}))
    mount(<HouseholdScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(screen.getByText(/Their access and agent tokens/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ data: { memberId: 'bob' } }),
    )
  })
})
