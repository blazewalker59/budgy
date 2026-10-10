import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from '@/lib/fuzzy'

describe('fuzzyMatch', () => {
  it('ranks a prefix above a word start above a substring, and a shorter label above a longer one', () => {
    const code = fuzzyMatch('code', 'Code')
    const review = fuzzyMatch('code', 'Code review')
    const word = fuzzyMatch('ref', 't4-ref-data')
    const inside = fuzzyMatch('ata', 't4-ref-data')
    expect(code!.score).toBeGreaterThan(review!.score)
    expect(word!.score).toBeGreaterThan(inside!.score)
    expect(word!.ranges).toEqual([[3, 5]])
    expect(inside!.ranges).toEqual([[8, 10]])
  })

  it('accepts a tight subsequence and refuses one strewn across the text', () => {
    const tight = fuzzyMatch('trd', 't4-ref-data')
    expect(tight).not.toBeNull()
    expect(tight!.ranges).toEqual([
      [0, 0],
      [3, 3],
      [7, 7],
    ])
    expect(
      fuzzyMatch('abc', `a${'x'.repeat(20)}b${'x'.repeat(20)}c`),
    ).toBeNull()
  })

  it('requires every token, prefers the label, and merges ranges', () => {
    expect(fuzzyMatch('', 'Anything')).toEqual({ score: 0, ranges: [] })
    expect(fuzzyMatch('missing', 'Code')).toBeNull()
    expect(fuzzyMatch('red apple', 'Red Apple')).not.toBeNull()
    expect(fuzzyMatch('red banana', 'Red Apple')).toBeNull()

    const label = fuzzyMatch('cat', 'Cat', 'cat')
    const keyword = fuzzyMatch('lease', 'Rent', 'apartment lease')
    expect(label!.ranges).toEqual([[0, 2]])
    expect(keyword!.ranges).toEqual([])
    expect(label!.score).toBeGreaterThan(keyword!.score)

    expect(fuzzyMatch('a b', 'ab')!.ranges).toEqual([[0, 1]])
  })
})
