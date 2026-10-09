import { describe, expect, it } from 'vitest'
import { ledger, txn } from '@test/factories'
import type { Lens } from '@/lib/model/lens'
import { indexLedger } from '@/lib/model/ledger'
import {
  describe as describeLens,
  filterLabel,
  filtersOf,
  isEmpty,
  matchLens,
  parseQuery,
  pick,
  readLens,
  savedLensInput,
  toggleFilter,
  vocabulary,
  whenLabel,
  withFilter,
  withoutFilter,
} from '@/lib/model/lens'

const TODAY = '2026-10-08'
const kroger = txn({
  id: 'k1',
  store: 'Kroger',
  account: 'Alex Apple Card',
  amount: 8412,
  date: '2026-09-17',
})
const bigKroger = txn({
  id: 'k2',
  store: 'Kroger',
  account: 'Blaze Apple Card',
  amount: 31_000,
  date: '2026-09-02',
})
const bistro = txn({
  id: 'b1',
  store: 'Bistro',
  description: 'BISTRO 42 ATLANTA',
  sourceCategory: 'Drinks & dining',
  account: 'Blaze Apple Card',
  amount: 4500,
  date: '2026-08-20',
  note: 'anniversary',
})
const refund = txn({
  id: 'r1',
  store: 'Amazon',
  sourceCategory: 'Shopping',
  account: 'Joint Checking (0001)',
  amount: -1999,
  date: '2026-10-01',
})
const odd = txn({
  id: 'u1',
  store: 'Pop-up',
  sourceCategory: 'Uncategorized',
  amount: 1200,
  date: '2026-10-02',
})
const ix = indexLedger(
  ledger({ txns: [kroger, bigKroger, bistro, refund, odd] }),
)
const all = ix.ledger.txns
const ids = (lens: Lens, planned = new Set<string>()) =>
  all.filter((t) => matchLens(ix, t, lens, planned)).map((t) => t.id)

describe('matchLens', () => {
  it('matches everything with no filters', () => {
    expect(ids({})).toHaveLength(5)
  })

  it('widens within a kind and narrows across kinds', () => {
    expect(ids({ people: ['Alex', 'Joint'] })).toEqual(['k1', 'r1'])
    expect(ids({ stores: ['Kroger'], people: ['Blaze'] })).toEqual(['k2'])
  })

  it('reads amounts by size, so a refund counts by how big it is', () => {
    expect(ids({ min: 5000 })).toEqual(['k1', 'k2'])
    expect(ids({ max: 2000 })).toEqual(['r1', 'u1'])
    expect(ids({ min: 8412, max: 8412 })).toEqual(['k1'])
  })

  it('filters by account type, category, tag and dates', () => {
    expect(ids({ kinds: ['checking'] })).toEqual(['r1'])
    expect(ids({ categories: ['Drinks & dining'] })).toEqual(['b1'])
    expect(ids({ from: '2026-09-01', to: '2026-09-30' })).toEqual(['k1', 'k2'])
    expect(ids({ tags: ['need'] })).toContain('k1')
  })

  it('knows refunds, planned bills, big purchases and uncategorized ones', () => {
    expect(ids({ flags: ['refunds'] })).toEqual(['r1'])
    expect(ids({ flags: ['planned'] }, new Set(['b1']))).toEqual(['b1'])
    expect(ids({ flags: ['big'] })).toEqual(['k2'])
    expect(ids({ flags: ['uncategorized'] })).toEqual(['u1'])
    expect(ids({ flags: ['refunds', 'big'] })).toEqual(['k2', 'r1'])
  })

  it('searches the store, description and note', () => {
    expect(ids({ q: 'atlanta' })).toEqual(['b1'])
    expect(ids({ q: 'ANNIVERSARY' })).toEqual(['b1'])
  })
})

describe('changing a Lens', () => {
  it('adds, toggles and removes filters', () => {
    let l: Lens = {}
    l = withFilter(l, { type: 'store', value: 'Kroger' })
    l = withFilter(l, { type: 'store', value: 'Kroger' })
    l = withFilter(l, { type: 'person', value: 'Alex' })
    expect(l).toEqual({ stores: ['Kroger'], people: ['Alex'] })
    l = toggleFilter(l, { type: 'store', value: 'Kroger' })
    expect(l).toEqual({ people: ['Alex'] })
    expect(isEmpty(withoutFilter(l, { type: 'person', value: 'Alex' }))).toBe(
      true,
    )
  })

  it('keeps one amount and one date range, the newest', () => {
    let l = withFilter({}, { type: 'amount', min: 5000 })
    l = withFilter(l, { type: 'amount', max: 2000 })
    expect(l).toEqual({ max: 2000 })
    l = withFilter(l, { type: 'when', from: '2026-09-01', to: '2026-09-30' })
    expect(filtersOf(l).map((f) => f.type)).toEqual(['amount', 'when'])
    expect(withoutFilter(l, { type: 'amount' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
  })

  it('keeps only what a screen honors', () => {
    expect(pick({ people: ['Alex'], stores: ['Kroger'] }, ['people'])).toEqual({
      people: ['Alex'],
    })
  })
})

describe('readLens', () => {
  it('takes a single value or a list, and drops what is wrong', () => {
    expect(
      readLens({
        people: 'Alex',
        kinds: ['credit', 'spaceship'],
        tags: ['fluff'],
        min: '5000',
        from: '2026-09-01',
        q: '  ',
        nonsense: 1,
      }),
    ).toEqual({ people: ['Alex'], tags: ['fluff'], min: 5000 })
  })

  it('drops a backwards or half date range', () => {
    expect(readLens({ from: '2026-09-30', to: '2026-09-01' })).toEqual({})
  })

  it('validates a saved Lens', () => {
    expect(
      savedLensInput.parse({
        id: 'ln_abc1234',
        name: ' Alex fun ',
        lens: { people: ['Alex'], tags: ['fluff'] },
      }),
    ).toEqual({
      id: 'ln_abc1234',
      name: 'Alex fun',
      lens: { people: ['Alex'], tags: ['fluff'] },
    })
    expect(() =>
      savedLensInput.parse({ id: 'ln_abc1234', name: 'x', lens: {} }),
    ).toThrow()
  })
})

describe('words', () => {
  it('labels each filter for its chip', () => {
    expect(filterLabel({ type: 'amount', min: 5000 })).toEqual([
      'Amount',
      '$50 and up',
    ])
    expect(filterLabel({ type: 'amount', max: 2050 })).toEqual([
      'Amount',
      'up to $20.50',
    ])
    expect(filterLabel({ type: 'amount', min: 8412, max: 8412 })).toEqual([
      'Amount',
      '$84.12',
    ])
    expect(filterLabel({ type: 'kind', value: 'credit' })).toEqual([
      'Type',
      'Credit card',
    ])
    expect(describeLens({ people: ['Alex'], flags: ['refunds'] })).toBe(
      'Alex · Refunds',
    )
  })

  it('names a whole month, a month so far, or a span', () => {
    expect(whenLabel('2026-09-01', '2026-09-30')).toBe('Sep 2026')
    expect(whenLabel('2026-10-01', '2026-10-08')).toBe('Oct 2026 so far')
    expect(whenLabel('2026-07-01', '2026-10-08')).toBe('Jul 1 – Oct 8')
  })
})

describe('parseQuery', () => {
  const terms = vocabulary(ix)
  const parse = (q: string) => parseQuery(q, terms, TODAY)

  it('reads several filters at once, longest phrase first', () => {
    expect(parse('kroger alex over 50 last month')).toEqual({
      filters: [
        { type: 'store', value: 'Kroger' },
        { type: 'person', value: 'Alex' },
        { type: 'amount', min: 5000 },
        { type: 'when', from: '2026-09-01', to: '2026-09-30' },
      ],
      rest: [],
    })
    expect(parse('alex apple card').filters).toEqual([
      { type: 'account', value: 'Alex Apple Card' },
    ])
  })

  it('knows other words for things', () => {
    expect(parse('dining fluff').filters).toEqual([
      { type: 'category', value: 'Drinks & dining' },
      { type: 'tag', value: 'fluff' },
    ])
    expect(parse('credit card refunds').filters).toEqual([
      { type: 'kind', value: 'credit' },
      { type: 'flag', value: 'refunds' },
    ])
  })

  it('reads amounts every usual way', () => {
    const amount = (q: string) => parse(q).filters[0]
    expect(amount('under 20')).toEqual({ type: 'amount', max: 2000 })
    expect(amount('>1k')).toEqual({ type: 'amount', min: 100_000 })
    expect(amount('50-200')).toEqual({ type: 'amount', min: 5000, max: 20_000 })
    expect(amount('between 10 and 25')).toEqual({
      type: 'amount',
      min: 1000,
      max: 2500,
    })
    expect(amount('84.12')).toEqual({ type: 'amount', min: 8412, max: 8412 })
  })

  it('reads dates relative to today', () => {
    const when = (q: string) => parse(q).filters[0]
    expect(when('sep')).toEqual({
      type: 'when',
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(when('november')).toEqual({
      type: 'when',
      from: '2025-11-01',
      to: '2025-11-30',
    })
    expect(when('this month')).toEqual({
      type: 'when',
      from: '2026-10-01',
      to: TODAY,
    })
    expect(when('last 3 months')).toEqual({
      type: 'when',
      from: '2026-07-01',
      to: TODAY,
    })
    expect(when('last 7 days')).toEqual({
      type: 'when',
      from: '2026-10-02',
      to: TODAY,
    })
  })

  it('gives back the words it could not read', () => {
    expect(parse('kroger birthday cake')).toEqual({
      filters: [{ type: 'store', value: 'Kroger' }],
      rest: ['birthday', 'cake'],
    })
  })
})
