// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ledger, txn } from '@test/factories'
import { CategoryControls } from '@/components/budget/CategoryControls'
import { indexLedger } from '@/lib/model/ledger'

const mocks = vi.hoisted(() => ({
  rename: vi.fn(),
  hide: vi.fn(),
  remove: vi.fn(),
  ix: null as unknown,
}))
vi.mock('@/lib/ledger/book', () => ({
  useBook: () => ({ ix: mocks.ix }),
}))
vi.mock('@/lib/ledger/useLedger', () => ({
  useRenameCategory: () => ({ mutate: mocks.rename }),
  useHideCategory: () => ({ mutate: mocks.hide }),
  useDeleteCategory: () => ({ mutate: mocks.remove }),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('CategoryControls', () => {
  it('renames a Category, refusing a name already taken', () => {
    mocks.ix = indexLedger(ledger({ txns: [txn({ sourceCategory: 'Pets' })] }))
    const onRenamed = vi.fn()
    render(<CategoryControls name="Pets" onRenamed={onRenamed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename Pets' }))
    const input = screen.getByLabelText('New name for Pets')
    fireEvent.change(input, { target: { value: 'groceries' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(mocks.rename).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Dog' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(mocks.rename).toHaveBeenCalledWith({ from: 'Pets', to: 'Dog' })
    expect(onRenamed).toHaveBeenCalledWith('Dog')
  })

  it('only hides a Category in use, but deletes an unused one after asking', () => {
    mocks.ix = indexLedger(ledger({ txns: [txn({ sourceCategory: 'Pets' })] }))
    const { unmount } = render(<CategoryControls name="Pets" />)
    expect(screen.queryByRole('button', { name: 'Delete Pets' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hide Pets' }))
    expect(mocks.hide).toHaveBeenCalledWith({ name: 'Pets', hidden: true })
    unmount()

    mocks.ix = indexLedger(ledger({ txns: [] }))
    render(<CategoryControls name="Tithe" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tithe' }))
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.remove).toHaveBeenCalledWith({ name: 'Tithe' })
  })

  it('shows a hidden Category can come back', () => {
    const l = ledger({ txns: [] })
    mocks.ix = indexLedger({
      ...l,
      categories: l.categories.map((c) =>
        c.name === 'Kids' ? { ...c, hidden: true } : c,
      ),
    })
    render(<CategoryControls name="Kids" />)
    expect(screen.getByText(/Its purchases still count/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show Kids' }))
    expect(mocks.hide).toHaveBeenCalledWith({ name: 'Kids', hidden: false })
  })
})
