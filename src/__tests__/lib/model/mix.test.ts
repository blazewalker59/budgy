import { describe, expect, it } from 'vitest'
import { EVERYTHING_ELSE, budgetMix } from '@/lib/model/mix'

describe('budgetMix', () => {
  it('gives each category its share of typical and of Targets', () => {
    const mix = budgetMix([
      { name: 'Groceries', typical: 300, target: 200 },
      { name: 'Dining', typical: 100, target: 200 },
    ])
    expect(mix).toEqual([
      {
        name: 'Groceries',
        typical: 300,
        target: 200,
        typicalShare: 0.75,
        targetShare: 0.5,
      },
      {
        name: 'Dining',
        typical: 100,
        target: 200,
        typicalShare: 0.25,
        targetShare: 0.5,
      },
    ])
  })

  it('folds the small ones together, biggest first', () => {
    const rows = ['a', 'b', 'c', 'd'].map((name, i) => ({
      name,
      typical: (4 - i) * 100,
      target: 0,
    }))
    const mix = budgetMix(rows, 2)
    expect(mix.map((m) => [m.name, m.typical])).toEqual([
      ['a', 400],
      ['b', 300],
      [EVERYTHING_ELSE, 300],
    ])
    expect(mix.reduce((n, m) => n + m.typicalShare, 0)).toBeCloseTo(1)
  })

  it('keeps a single leftover under its own name and drops empty ones', () => {
    const mix = budgetMix(
      [
        { name: 'a', typical: 100, target: 100 },
        { name: 'b', typical: 50, target: 0 },
        { name: 'empty', typical: 0, target: 0 },
      ],
      1,
    )
    expect(mix.map((m) => m.name)).toEqual(['a', 'b'])
    expect(budgetMix([])).toEqual([])
  })
})
