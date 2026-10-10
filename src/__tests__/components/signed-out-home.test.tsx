// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { SignIn } from '@/components/layout/SignIn'

const mocks = vi.hoisted(() => ({ social: vi.fn(), signOut: vi.fn() }))
vi.mock('@/lib/auth/client', () => ({
  signIn: { social: mocks.social },
  signOut: mocks.signOut,
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('Signed-out home', () => {
  it('explains current features and restricted access without reading or implying live financial data', () => {
    render(<SignIn />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Plan life together',
    )
    expect(screen.getByText('Know where the money went')).toBeTruthy()
    expect(screen.getByText('Plan for what’s coming')).toBeTruthy()
    expect(screen.getByText('Track balances')).toBeTruthy()
    expect(screen.getByText('Share it')).toBeTruthy()
    expect(screen.getByText(/Invite-only for now/)).toBeTruthy()
    expect(
      screen.getByText(/SimpleFIN Bridge to sync them automatically/),
    ).toBeTruthy()
    expect(screen.getByText('Example data')).toBeTruthy()
    expect(screen.getByText(/not a real Household/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /create account/i })).toBeNull()
    expect(mocks.social).not.toHaveBeenCalled()
  })

  it('keeps each homepage sign-in entry point aimed at the existing onboarding flow', async () => {
    mocks.social.mockResolvedValue({ error: null })
    render(<SignIn />)
    const buttons = screen.getAllByRole('button', {
      name: 'Sign in with Google',
    })
    expect(buttons).toHaveLength(2)
    for (const button of buttons) fireEvent.click(button)
    await waitFor(() => expect(mocks.social).toHaveBeenCalledTimes(2))
    expect(mocks.social).toHaveBeenNthCalledWith(1, {
      provider: 'google',
      callbackURL: '/',
    })
    expect(mocks.social).toHaveBeenNthCalledWith(2, {
      provider: 'google',
      callbackURL: '/',
    })
  })

  it('preserves invitation return paths with a focused sign-in screen', async () => {
    mocks.social.mockResolvedValue({ error: null })
    const callbackURL = `/join/${'a'.repeat(43)}`
    render(<SignIn callbackURL={callbackURL} />)
    expect(
      screen.getByRole('heading', { name: 'Join your Household' }),
    ).toBeTruthy()
    expect(screen.getByText(/confirm before joining/)).toBeTruthy()
    expect(screen.queryByText('Example data')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() =>
      expect(mocks.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL,
      }),
    )
  })

  it('shows a recoverable message when starting Google sign-in fails', async () => {
    mocks.social.mockRejectedValue(new Error('Network error'))
    render(<SignIn />)
    const button = screen.getAllByRole('button', {
      name: 'Sign in with Google',
    })[0]
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Couldn’t start sign-in. Try again.',
    )
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('also handles errors returned by the authentication client', async () => {
    mocks.social.mockResolvedValue({
      error: { message: 'Sign-in is temporarily unavailable' },
    })
    render(<SignIn />)
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Sign in with Google' })[1],
    )
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Sign-in is temporarily unavailable',
    )
  })
})
