// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ledger, txn } from '@test/factories'
import { TxnList } from '@/components/shared/TxnList'
import { indexLedger } from '@/lib/model/ledger'

const ix = indexLedger(ledger())
vi.mock('@/lib/ledger/book', () => ({
  useBook: () => ({ ix, plannedIds: new Set() }),
}))
vi.mock('@/lib/ledger/useLedger', () => ({
  useMoveTxn: () => ({ mutate: vi.fn() }),
  useNoteTxn: () => ({ mutate: vi.fn() }),
  useSetStoreRule: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/components/shared/CategorySelect', () => ({
  CategorySelect: () => null,
}))
afterEach(cleanup)

describe('TxnList', () => {
  it('shows purchases newest first, the larger first on the same day', () => {
    render(
      <TxnList
        txns={[
          txn({ date: '2026-10-01', store: 'Oldest', amount: 900 }),
          txn({ date: '2026-10-09', store: 'Smaller', amount: 100 }),
          txn({ date: '2026-10-09', store: 'Larger', amount: 500 }),
          txn({ date: '2026-10-05', store: 'Middle', amount: 300 }),
        ]}
      />,
    )
    const order = ['Larger', 'Smaller', 'Middle', 'Oldest'].map(
      (name) => screen.getAllByText(name)[0],
    )
    for (let i = 1; i < order.length; i++)
      expect(
        order[i - 1].compareDocumentPosition(order[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
  })
})
