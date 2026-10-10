import { describe, expect, it } from 'vitest'
import type { ExistingPurchase } from '@/lib/updates/reconcile'
import type { PostedRow } from '@/lib/import/posted'
import { sha1Hex } from '@/lib/import/rows'
import { EMPTY_RULES } from '@/lib/import/rules'
import { prepareIdentified } from '@/lib/updates/reconcile'

const row = (over: Partial<PostedRow> = {}): PostedRow => ({
  date: '2026-10-01',
  description: 'Kroger',
  amount: 12.34,
  sourceId: 's1',
  ...over,
})

const purchase = (over: Partial<ExistingPurchase> = {}): ExistingPurchase => ({
  id: 'old',
  date: '2026-10-01',
  amount: 1234,
  description: 'KROGER #1234',
  sourceKey: null,
  ...over,
})

function identify(
  rows: Array<PostedRow>,
  existing: Array<ExistingPurchase> = [],
) {
  return prepareIdentified({
    account: 'Card',
    namespace: 'bank:1',
    rows,
    existing,
    categories: ['Groceries'],
    history: new Map(),
    rules: EMPTY_RULES,
  })
}

describe('prepareIdentified money matching', () => {
  it('links one same-day purchase with the same cents and store, and adds nothing', async () => {
    const result = await identify([row()], [purchase()])
    expect(result.links).toEqual([
      {
        id: 'old',
        sourceKey: await sha1Hex(JSON.stringify(['bank:1', 's1'])),
      },
    ])
    expect(result.prepared.fresh).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it('treats one cent of difference as a new purchase', async () => {
    const result = await identify([row()], [purchase({ amount: 1235 })])
    expect(result.links).toEqual([])
    expect(result.conflicts).toEqual([])
    expect(result.prepared.fresh).toHaveLength(1)
    expect(result.prepared.fresh[0]?.amount).toBe(1234)
  })

  it('refuses to guess when two purchases share the day, the cents, and the store', async () => {
    const result = await identify(
      [row()],
      [purchase({ id: 'a' }), purchase({ id: 'b' })],
    )
    expect(result.links).toEqual([])
    expect(result.prepared.fresh).toEqual([])
    expect(result.conflicts).toEqual([
      {
        date: '2026-10-01',
        description: 'Kroger',
        amount: 12.34,
        reason:
          'Several existing purchases match. Nothing was added. Review the matches.',
      },
    ])
  })

  it('holds a purchase within three days for review, and files one further away', async () => {
    const near = await identify([row()], [purchase({ date: '2026-09-28' })])
    expect(near.links).toEqual([])
    expect(near.prepared.fresh).toEqual([])
    expect(near.conflicts[0]?.reason).toBe(
      'This may match a purchase with a different date. Review it.',
    )

    const far = await identify([row()], [purchase({ date: '2026-09-27' })])
    expect(far.conflicts).toEqual([])
    expect(far.prepared.fresh).toHaveLength(1)
  })

  it('does not match a legacy purchase twice', async () => {
    const result = await identify(
      [row({ sourceId: 's1' }), row({ sourceId: 's2', amount: 12.34 })],
      [purchase()],
    )
    expect(result.links).toHaveLength(1)
    expect(result.prepared.fresh).toHaveLength(1)
    expect(result.conflicts).toEqual([])
  })

  it('records a changed amount in cents instead of adding the purchase again', async () => {
    const sourceKey = await sha1Hex(JSON.stringify(['bank:1', 's1']))
    const result = await identify(
      [row({ amount: 6.5, description: 'Kroger' })],
      [purchase({ amount: 500, description: 'Kroger', sourceKey })],
    )
    expect(result.links).toEqual([])
    expect(result.prepared.fresh).toEqual([])
    expect(result.changes).toEqual([
      {
        id: 'old',
        sourceKey,
        date: '2026-10-01',
        amount: 650,
        description: 'Kroger',
      },
    ])
  })

  it('leaves out money that is not spending, even when the amount matches', async () => {
    const result = await identify(
      [row({ description: 'Investment Disbursement', amount: 12.34 })],
      [purchase({ description: 'Investment Disbursement' })],
    )
    expect(result.links).toEqual([])
    expect(result.prepared.fresh).toEqual([])
    expect(result.prepared.notSpending).toBe(1)
  })
})
