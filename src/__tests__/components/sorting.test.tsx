// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ledger, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { UnsortedStores } from '@/components/setup/UnsortedStores'
import { BankCategories } from '@/components/accounts/BankCategories'

const mocks = vi.hoisted(() => ({
  rule: vi.fn(),
  file: vi.fn(),
  ix: null as unknown,
  bank: [] as Array<unknown>,
}))
vi.mock('@/lib/ledger/book', () => ({ useBook: () => ({ ix: mocks.ix }) }))
vi.mock('@/lib/ledger/useLedger', () => ({
  useSetStoreRule: () => ({ mutate: mocks.rule }),
}))
vi.mock('@/lib/ledger/useBankCategories', () => ({
  useBankCategories: () => ({ data: mocks.bank, isError: false }),
  useFileBankCategory: () => ({ mutate: mocks.file }),
}))
vi.mock('@/components/shared/CategorySelect', () => ({
  CategorySelect: ({
    label,
    onChange,
  }: {
    label: string
    onChange: (c: string) => void
  }) => (
    <button type="button" onClick={() => onChange('Health')}>
      {label}
    </button>
  ),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('UnsortedStores', () => {
  it('files a Store for good with a store-wide rule', () => {
    mocks.ix = indexLedger(
      ledger({
        txns: [txn({ store: 'Gym', sourceCategory: 'Uncategorized' })],
      }),
    )
    render(<UnsortedStores />)
    fireEvent.click(screen.getByRole('button', { name: 'Category for Gym' }))
    expect(mocks.rule).toHaveBeenCalledWith({
      sourceCategory: '*',
      store: 'Gym',
      category: 'Health',
    })
  })

  it('says when nothing is left', () => {
    mocks.ix = indexLedger(ledger({ txns: [txn()] }))
    render(<UnsortedStores />)
    expect(screen.getByRole('status').textContent).toBe('Nothing left to sort.')
  })
})

describe('BankCategories', () => {
  it('lists the bank’s categories and files one', () => {
    mocks.bank = [
      {
        name: 'Medical',
        purchases: 3,
        unsorted: 2,
        spent: 9000,
        means: null,
      },
    ]
    render(<BankCategories />)
    expect(screen.getByText(/2 to sort/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Category for Medical' }),
    )
    expect(mocks.file).toHaveBeenCalledWith({
      name: 'Medical',
      category: 'Health',
    })
  })
})
