// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PersonaSummary } from '@/lib/demo/service'
import { DemoBanner } from '@/components/demo/DemoBanner'
import { AdminScreen } from '@/components/demo/AdminScreen'
import { SETUP_STEPS } from '@/lib/model/setup'

const mocks = vi.hoisted(() => ({
  personas: vi.fn(),
  create: vi.fn(),
  actAs: vi.fn(),
  exit: vi.fn(),
  reset: vi.fn(),
  remove: vi.fn(),
  replay: vi.fn(),
}))
vi.mock('@/lib/demo/server', () => ({
  getDemoPersonas: mocks.personas,
  newDemoPersona: mocks.create,
  actAsDemoPersona: mocks.actAs,
  exitDemo: mocks.exit,
  resetDemoPersona: mocks.reset,
  deleteDemoPersona: mocks.remove,
  replayDemoInvite: mocks.replay,
}))

const replace = vi.fn()
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace, origin: 'http://localhost:3000' },
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const clear = vi.spyOn(client, 'clear')
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return { clear }
}

const SAM = 'demo_' + 'a'.repeat(32)
const ALEX = 'demo_' + 'b'.repeat(32)
const demo = {
  persona: { id: SAM, name: 'Sam (demo)', email: 'sam-1@demo.invalid' },
  admin: { name: 'Ada', email: 'ada@example.com' },
}

describe('DemoBanner', () => {
  it('says who is being acted as, unmistakably', () => {
    renderWith(<DemoBanner demo={demo} />)
    expect(screen.getByRole('region', { name: 'Demo' }).textContent).toContain(
      'Demo: acting as Sam (demo)',
    )
    expect(
      screen.getByRole('link', { name: 'Switch persona' }).getAttribute('href'),
    ).toBe('/admin')
  })

  it('exits back to the admin’s own Household, clearing every cache', async () => {
    mocks.exit.mockResolvedValue(undefined)
    const { clear } = renderWith(<DemoBanner demo={demo} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit demo' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(clear).toHaveBeenCalled()
  })

  it('resets the persona it is acting as, after confirming', async () => {
    mocks.reset.mockResolvedValue(undefined)
    renderWith(<DemoBanner demo={demo} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to start' }))
    await waitFor(() =>
      expect(mocks.reset).toHaveBeenCalledWith({ data: { personaId: SAM } }),
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })
})

const steps = SETUP_STEPS.map((id) => ({
  id,
  done: id === 'household',
  skipped: id === 'pay',
}))
const sam: PersonaSummary = {
  id: SAM,
  label: 'Sam',
  name: 'Sam (demo)',
  email: 'sam-1@demo.invalid',
  createdAt: 0,
  acting: false,
  household: {
    name: 'Sam home',
    role: 'owner',
    members: 1,
    invites: 0,
    purchases: 12,
    accounts: 2,
    bankConnections: 0,
    steps,
  },
}

describe('AdminScreen', () => {
  it('lists personas with their Household and setup progress', async () => {
    mocks.personas.mockResolvedValue([
      sam,
      { ...sam, id: ALEX, name: 'Alex (demo)', household: null },
    ])
    renderWith(<AdminScreen />)
    expect(await screen.findByText('Setup: 2 of 9 done')).toBeTruthy()
    expect(screen.getByText(/Owner of Sam home/)).toBeTruthy()
    expect(screen.getByText(/No Household yet/)).toBeTruthy()
    expect(
      screen.getByLabelText<HTMLInputElement>('SimpleFIN demo token').value,
    ).toBe(
      'aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy9zaW1wbGVmaW4vY2xhaW0vZGVtbw==',
    )
  })

  it('acts as a persona with a full reload', async () => {
    mocks.personas.mockResolvedValue([sam])
    mocks.actAs.mockResolvedValue(undefined)
    renderWith(<AdminScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Act as' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(mocks.actAs).toHaveBeenCalledWith({ data: { personaId: SAM } })
  })

  it('replays an invitation and opens it as the new persona', async () => {
    mocks.personas.mockResolvedValue([sam])
    mocks.replay.mockResolvedValue({
      persona: { id: ALEX, name: 'Partner (demo)' },
      path: '/join/' + 'x'.repeat(43),
    })
    mocks.actAs.mockResolvedValue(undefined)
    renderWith(<AdminScreen />)
    fireEvent.click(await screen.findByRole('button', { name: 'Invite them' }))
    expect(
      (await screen.findByLabelText<HTMLInputElement>('Invitation link')).value,
    ).toBe(`http://localhost:3000/join/${'x'.repeat(43)}`)
    expect(mocks.replay).toHaveBeenCalledWith({
      data: { fromPersonaId: SAM, label: 'Partner' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Act as Partner (demo) and open the link',
      }),
    )
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/join/' + 'x'.repeat(43)),
    )
    expect(mocks.actAs).toHaveBeenCalledWith({ data: { personaId: ALEX } })
  })

  it('shows a non-admin only the server’s refusal', async () => {
    mocks.personas.mockRejectedValue(new Error('Page not found'))
    renderWith(<AdminScreen />)
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Page not found',
    )
  })
})
