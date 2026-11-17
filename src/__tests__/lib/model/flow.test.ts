import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { monthView } from '@/lib/model/month'
import { monthFlow } from '@/lib/model/flow'

describe('monthFlow', () => {
  const spend = (sourceCategory: string, amount: number) =>
    txn({ date: '2026-11-05', store: sourceCategory, sourceCategory, amount })
  const view = monthView(
    indexLedger(
      ledger({
        txns: [
          spend('Groceries', 50_000),
          spend('Pets', 10_000),
          spend('Healthcare', 5_000),
          spend('Insurance', 4_000),
          spend('Auto & transport', 3_000),
          spend('Shopping', 20_000),
          spend('Drinks & dining', 10_000),
          spend('Mortgage', 100_000),
        ],
      }),
    ),
    '2026-11',
    '2026-11-16',
    null,
    [],
  )
  const ids = (flow: ReturnType<typeof monthFlow>, column: number) =>
    flow.nodes.filter((n) => n.column === column).map((n) => n.id)
  const link = (flow: ReturnType<typeof monthFlow>, from: string, to: string) =>
    flow.links.find((l) => l.from === from && l.to === to)?.value

  it('flows take-home into what it paid for, with the rest left', () => {
    const flow = monthFlow(view, 300_000)
    expect(ids(flow, 0)).toEqual(['pay'])
    expect(ids(flow, 1)).toEqual(['housing', 'everyday', 'left'])
    expect(link(flow, 'pay', 'housing')).toBe(100_000)
    expect(link(flow, 'pay', 'everyday')).toBe(102_000)
    expect(link(flow, 'pay', 'left')).toBe(98_000)
  })

  it('shows spending past take-home as coming from beyond it', () => {
    const flow = monthFlow(view, 150_000)
    expect(ids(flow, 0)).toEqual(['pay', 'beyond'])
    expect(ids(flow, 1)).not.toContain('left')
    expect(link(flow, 'pay', 'housing')).toBe(100_000)
    expect(link(flow, 'pay', 'everyday')).toBe(50_000)
    expect(link(flow, 'beyond', 'everyday')).toBe(52_000)
  })

  it('splits everyday by tag, then the biggest Categories and the rest', () => {
    const flow = monthFlow(view, 300_000)
    expect(ids(flow, 2)).toEqual(['need', 'nice', 'fluff'])
    expect(link(flow, 'everyday', 'need')).toBe(72_000)
    expect(ids(flow, 3)).toEqual([
      'category:Groceries',
      'category:Pets',
      'category:Healthcare',
      'other:need',
      'category:Shopping',
      'category:Drinks & dining',
    ])
    expect(link(flow, 'need', 'other:need')).toBe(7_000)
    expect(flow.nodes.find((n) => n.id === 'other:need')?.label).toBe(
      'Other need',
    )
  })

  it('starts at the spending without take-home', () => {
    const flow = monthFlow(view, null)
    expect(ids(flow, 0)).toEqual([])
    expect(ids(flow, 1)).toEqual(['housing', 'everyday'])
    expect(flow.links.some((l) => l.from === 'pay')).toBe(false)
  })

  it('flows everyday straight into its biggest Categories when compact', () => {
    const flow = monthFlow(view, 300_000, { compact: true })
    expect(ids(flow, 1)).toEqual(['housing', 'everyday', 'left'])
    // No tag column: six Categories by size, the seventh as "1 more".
    expect(ids(flow, 2)).toEqual([
      'category:Groceries',
      'category:Shopping',
      'category:Drinks & dining',
      'category:Pets',
      'category:Healthcare',
      'category:Insurance',
      'other',
    ])
    expect(ids(flow, 3)).toEqual([])
    // Each keeps its tag, for its color.
    expect(flow.nodes.find((n) => n.id === 'category:Shopping')?.kind).toBe(
      'nice',
    )
    expect(flow.nodes.find((n) => n.id === 'other')).toMatchObject({
      label: '1 more',
      kind: 'rest',
      value: 3_000,
    })
    expect(link(flow, 'everyday', 'category:Groceries')).toBe(50_000)
  })
})
