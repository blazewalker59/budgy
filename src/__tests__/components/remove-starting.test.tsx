// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RemoveStarting } from '@/components/accounts/RemoveStarting'

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }))
vi.mock('@/lib/ledger/useLedger', () => ({
  useRemoveStarting: () => ({ mutate: mocks.mutate, error: null }),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('RemoveStarting', () => {
  it('asks before removing, and Cancel backs out', () => {
    render(<RemoveStarting count={2326} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove all 2,326' }))
    expect(screen.getByRole('alertdialog').textContent).toContain(
      'Remove 2,326 starting purchases?',
    )
    expect(mocks.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('removes every Account’s, or one Account’s, once confirmed', () => {
    render(<RemoveStarting count={30} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove all 30' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.mutate).toHaveBeenCalledWith({})
    cleanup()
    render(<RemoveStarting account="Card" count={1} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove 1 starting purchase' }),
    )
    expect(screen.getByRole('alertdialog').textContent).toContain('from Card?')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(mocks.mutate).toHaveBeenLastCalledWith({ account: 'Card' })
  })
})
