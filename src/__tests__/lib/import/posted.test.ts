import { describe, expect, it } from 'vitest'
import { UNCATEGORIZED, preparePosted, storeHistory } from '@/lib/import/posted'

const ACCOUNT = 'Blaze Apple Card'

type Input = Parameters<typeof preparePosted>[0]

const prep = (
  rows: Input['rows'],
  existing: Input['existing'] = [],
  more: Partial<Input> = {},
) =>
  preparePosted({
    account: ACCOUNT,
    rows,
    categories: ['Groceries', 'Drinks & dining'],
    history: storeHistory([{ store: 'Kroger', sourceCategory: 'Groceries' }]),
    existing,
    ...more,
  })

describe('storeHistory', () => {
  it('files each Store where most of its purchases went', () => {
    const h = storeHistory([
      { store: 'Target', sourceCategory: 'Shopping' },
      { store: 'Target', sourceCategory: 'Groceries' },
      { store: 'Target', sourceCategory: 'Shopping' },
    ])
    expect(h.get('target')).toEqual({ store: 'Target', category: 'Shopping' })
  })
})

describe('preparePosted', () => {
  it('files by the category given, else the store’s history, else Uncategorized', async () => {
    const p = await prep([
      {
        date: '2026-10-07',
        description: 'Corner Cafe',
        amount: 12.5,
        category: 'drinks & dining',
      },
      { date: '2026-10-07', description: 'KROGER', amount: 80 },
      { date: '2026-10-07', description: 'New Place', amount: 9 },
    ])
    expect(p.fresh.map((t) => [t.store, t.sourceCategory, t.filed])).toEqual([
      ['Corner Cafe', 'Drinks & dining', 'given'],
      ['Kroger', 'Groceries', 'store history'],
      ['New Place', UNCATEGORIZED, 'uncategorized'],
    ])
    expect(p.fresh[0]).toMatchObject({
      account: ACCOUNT,
      amount: 1250,
      month: '2026-10',
    })
  })

  it('makes the same ids every time, so posting a day twice adds nothing', async () => {
    const rows = [
      { date: '2026-10-07', description: 'Coffee', amount: 5 },
      { date: '2026-10-07', description: 'Coffee', amount: 5 },
    ]
    const first = await prep(rows)
    expect(first.fresh).toHaveLength(2)
    const again = await prep(
      rows,
      first.fresh.map((t) => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        description: t.description,
      })),
    )
    expect(again).toMatchObject({ alreadyHad: 2, duplicates: [] })
    expect(again.fresh).toEqual([])
  })

  it('adds a second identical purchase when only the first was there', async () => {
    const one = await prep([
      { date: '2026-10-07', description: 'Coffee', amount: 5 },
    ])
    const existing = one.fresh.map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      description: t.description,
    }))
    const two = await prep(
      [
        { date: '2026-10-07', description: 'Coffee', amount: 5 },
        { date: '2026-10-07', description: 'Coffee', amount: 5 },
      ],
      existing,
    )
    expect(two.alreadyHad).toBe(1)
    expect(two.fresh).toHaveLength(1)
  })

  it('leaves out a purchase already there under another description', async () => {
    const p = await prep(
      [
        {
          date: '2026-10-07',
          description: 'APPLE CASH STARBUCKS 123',
          amount: 6.25,
        },
      ],
      [
        {
          id: 'abc',
          date: '2026-10-07',
          amount: 625,
          description: 'Starbucks',
        },
      ],
    )
    expect(p.fresh).toEqual([])
    expect(p.duplicates).toEqual([
      expect.objectContaining({ existing: 'Starbucks', amount: 6.25 }),
    ])
  })

  it('leaves out rows that aren’t spending, and files upkeep by the rules', async () => {
    const p = await prep(
      [
        { date: '2026-10-07', description: 'Escrow Disbursement', amount: 900 },
        { date: '2026-10-07', description: 'Index Fund Buy', amount: 500 },
        { date: '2026-10-07', description: 'Green Lawn 555', amount: 75 },
      ],
      [],
      {
        rules: {
          stores: [],
          upkeep: 'Green Lawn',
          hardware: [],
          upkeepExclude: '',
          mortgage: '',
          mortgageCategory: '',
          notSpending: 'Index Fund',
        },
      },
    )
    expect(p.notSpending).toBe(2)
    expect(p.fresh.map((t) => t.sourceCategory)).toEqual(['Home upkeep'])
  })

  it('carries a replaced starting purchase’s Move and note to its match', async () => {
    const p = await prep(
      [
        { date: '2026-10-07', description: 'KROGER #123', amount: 80 },
        { date: '2026-10-08', description: 'Corner Cafe', amount: 12.5 },
      ],
      [],
      {
        replacing: [
          {
            id: 'old1',
            date: '2026-10-07',
            amount: 8000,
            description: 'Kroger',
            store: 'Kroger Marketplace',
            sourceCategory: 'Groceries',
            category: 'Hosting',
            note: 'party',
          },
          {
            id: 'old2',
            date: '2026-10-08',
            amount: 999,
            description: 'Elsewhere',
            store: 'Elsewhere',
            sourceCategory: 'Gifts',
            category: 'Gifts',
            note: null,
          },
        ],
      },
    )
    expect(p.carried).toBe(1)
    expect(
      p.fresh.map((t) => [
        t.store,
        t.sourceCategory,
        t.category,
        t.note,
        t.filed,
      ]),
    ).toEqual([
      ['Kroger Marketplace', 'Groceries', 'Hosting', 'party', 'replaced'],
      ['Corner Cafe', UNCATEGORIZED, null, null, 'uncategorized'],
    ])
  })

  it('knows a Store already here by its name in any case', async () => {
    const p = await prep(
      [{ date: '2026-10-07', description: 'BLUE DOOR GYM', amount: 40 }],
      [],
      {
        history: storeHistory([
          { store: 'Blue Door Gym', sourceCategory: 'Kids' },
          { store: 'Blue Door Gym', sourceCategory: 'Kids' },
          { store: 'BLUE DOOR GYM', sourceCategory: 'Fitness' },
        ]),
      },
    )
    expect(p.fresh[0]).toMatchObject({
      store: 'Blue Door Gym',
      sourceCategory: 'Kids',
      filed: 'store history',
    })
  })
})
