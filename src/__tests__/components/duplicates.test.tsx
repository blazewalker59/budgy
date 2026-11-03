// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Txn } from '@/lib/model/types'
import { Duplicates } from '@/components/accounts/Duplicates'

const mocks = vi.hoisted(() => ({
  merge: vi.fn(),
  keep: vi.fn(),
  pairs: [] as Array<unknown>,
}))
vi.mock('@/lib/ledger/book', () => ({ useBook: () => ({ ix: {} }) }))
vi.mock('@/lib/ledger/useLedger', () => ({
  useMergeDuplicate: () => ({ mutate: mocks.merge, isPending: false }),
  useKeepDuplicate: () => ({ mutate: mocks.keep, isPending: false }),
}))
vi.mock('@/lib/model/duplicates', () => ({
  possibleDuplicates: () => mocks.pairs,
}))
vi.mock('@/lib/model/ledger', () => ({ categoryOf: () => 'Shopping' }))

const txn = (over: Partial<Txn>): Txn => ({
  id: 'a',
  date: '2026-07-19',
  month: '2026-07',
  account: 'Sam Apple Card',
  description: 'TARGET',
  store: 'Target',
  sourceCategory: 'Shopping',
  amount: 856,
  category: null,
  note: null,
  ...over,
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  mocks.pairs = []
})

describe('Duplicates', () => {
  it('shows nothing with no duplicates', () => {
    const { container } = render(<Duplicates />)
    expect(container.textContent).toBe('')
  })

  it('folds every pair into one line until opened, then one row each', () => {
    mocks.pairs = [
      {
        key: 'k1',
        stays: txn({ id: 's1', starting: true }),
        goes: txn({ id: 'g1', synced: true }),
      },
      {
        key: 'k2',
        stays: txn({ id: 's2', store: 'Delta', amount: 86879 }),
        goes: txn({ id: 'g2', store: 'Delta Air Lines' }),
      },
    ]
    render(<Duplicates />)
    expect(screen.getByText('2 possible duplicates')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /2 possible/ }))
    expect(screen.getAllByRole('button', { name: 'Merge' })).toHaveLength(2)
    // Only how the two differ: where each came from, a second name.
    expect(
      screen.getByText(/Sam Apple Card · Shopping · starting \+ bank sync/),
    ).toBeTruthy()
    expect(screen.getByText('/ Delta Air Lines')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Merge' })[0])
    expect(mocks.merge).toHaveBeenCalledWith({ goes: 'g1', stays: 's1' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep both' })[1])
    expect(mocks.keep).toHaveBeenCalledWith({ goes: 'g2', stays: 's2' })
  })
})
