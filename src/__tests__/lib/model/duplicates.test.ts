import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { pairKey, possibleDuplicates } from '@/lib/model/duplicates'

const account = 'Joint Checking (0001)'
const uploaded = txn({
  date: '2026-10-01',
  account,
  store: 'Shellpoint',
  amount: 210_000,
})
const synced = txn({
  date: '2026-10-01',
  account,
  store: 'Ach Pmt Newrez-shellpoint',
  amount: 210_000,
  synced: true,
})

describe('possible duplicates', () => {
  it('pairs a synced purchase with one already here of the same amount', () => {
    const pairs = possibleDuplicates(
      indexLedger(ledger({ txns: [uploaded, synced] })),
    )
    expect(pairs).toEqual([
      { synced, other: uploaded, key: pairKey(synced.id, uploaded.id) },
    ])
  })

  it('takes the nearest date, and never pairs one purchase twice', () => {
    const near = { ...uploaded, id: 'near', date: '2026-10-02' }
    const far = { ...uploaded, id: 'far', date: '2026-09-29' }
    const again = { ...synced, id: 'again', date: '2026-10-02' }
    const pairs = possibleDuplicates(
      indexLedger(ledger({ txns: [far, near, synced, again] })),
    )
    expect(pairs.map((p) => [p.synced.id, p.other.id])).toEqual([
      ['again', 'far'],
      [synced.id, 'near'],
    ])
  })

  it('leaves other Accounts, other amounts, distant dates and kept pairs alone', () => {
    const cases = [
      { ...uploaded, account: 'Blaze Apple Card' },
      { ...uploaded, amount: 210_001 },
      { ...uploaded, date: '2026-10-05' },
    ]
    for (const other of cases)
      expect(
        possibleDuplicates(indexLedger(ledger({ txns: [other, synced] }))),
      ).toEqual([])
    expect(
      possibleDuplicates(
        indexLedger(
          ledger({
            txns: [uploaded, synced],
            kept: [pairKey(uploaded.id, synced.id)],
          }),
        ),
      ),
    ).toEqual([])
  })

  it('never pairs two synced purchases: the bank knows those apart', () => {
    expect(
      possibleDuplicates(
        indexLedger(ledger({ txns: [{ ...uploaded, synced: true }, synced] })),
      ),
    ).toEqual([])
  })
})
