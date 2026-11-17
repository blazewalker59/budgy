import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import { indexLedger } from '@/lib/model/ledger'
import { monthView } from '@/lib/model/month'
import { everydayRings } from '@/lib/model/rings'

describe('everydayRings', () => {
  const spend = (sourceCategory: string, amount: number) =>
    txn({ date: '2026-11-05', store: sourceCategory, sourceCategory, amount })
  const rings = (...txns: Array<ReturnType<typeof txn>>) =>
    everydayRings(
      monthView(
        indexLedger(ledger({ txns })),
        '2026-11',
        '2026-11-16',
        null,
        [],
      ),
      9,
    )

  it('rings tags outside and their Categories inside, biggest first', () => {
    const r = rings(
      spend('Shopping', 30_000),
      spend('Groceries', 50_000),
      spend('Pets', 15_000),
      spend('Drinks & dining', 5_000),
      // Housing isn't everyday.
      spend('Mortgage', 200_000),
    )
    expect(r.total).toBe(100_000)
    expect(r.tags).toEqual([
      { tag: 'need', value: 65_000 },
      { tag: 'nice', value: 30_000 },
      { tag: 'fluff', value: 5_000 },
    ])
    expect(r.slices.map((s) => s.name)).toEqual([
      'Groceries',
      'Pets',
      'Shopping',
      'Drinks & dining',
    ])
    // Ranked by size across tags, for their colors.
    expect(r.slices.map((s) => s.rank)).toEqual([0, 2, 1, 3])
  })

  it('gives only the biggest few a slice of their own', () => {
    const r = everydayRings(
      monthView(
        indexLedger(
          ledger({
            txns: [
              spend('Groceries', 40_000),
              spend('Pets', 30_000),
              spend('Healthcare', 20_000),
              spend('Shopping', 10_000),
            ],
          }),
        ),
        '2026-11',
        '2026-11-16',
        null,
        [],
      ),
      1,
    )
    expect(r.slices.map((s) => [s.name, s.rank])).toEqual([
      ['Groceries', 0],
      ['2 more Need', null],
      // The only one left in its tag keeps its name, but not a color.
      ['Shopping', null],
    ])
  })

  it('folds a tag’s Categories too small to see into one slice', () => {
    const r = rings(
      spend('Groceries', 97_000),
      spend('Pets', 1_000),
      spend('Healthcare', 1_500),
      spend('Shopping', 500),
    )
    const need = r.slices.filter((s) => s.tag === 'need')
    expect(need.map((s) => s.name)).toEqual(['Groceries', '2 more Need'])
    expect(need[1]).toMatchObject({ value: 2_500, category: null, rank: null })
    expect(need[1].folded.map((c) => c.name)).toEqual(['Healthcare', 'Pets'])
    // A lone small one stays itself, without a color of its own.
    expect(r.slices.find((s) => s.tag === 'nice')).toMatchObject({
      name: 'Shopping',
      rank: null,
    })
  })

  it('is empty with nothing spent', () => {
    expect(rings()).toEqual({ total: 0, tags: [], slices: [] })
  })
})
