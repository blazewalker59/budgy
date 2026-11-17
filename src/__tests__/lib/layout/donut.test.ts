import { describe, expect, it } from 'vitest'
import { arcPath, arcs } from '@/lib/layout/donut'

const TOP = -Math.PI / 2
const span = (a: { start: number; end: number }) => a.end - a.start

describe('arcs', () => {
  it('shares the ring in proportion, clockwise from the top', () => {
    const [a, b] = arcs([3, 1])
    expect(a.start).toBeCloseTo(TOP)
    expect(span(a)).toBeCloseTo(1.5 * Math.PI)
    expect(b.start).toBeCloseTo(a.end)
    expect(b.end).toBeCloseTo(TOP + 2 * Math.PI)
  })

  it('leaves a gap between neighbours, but not around a lone arc', () => {
    const gap = 0.1
    const [a, b] = arcs([1, 1], gap)
    expect(b.start - a.end).toBeCloseTo(gap)
    expect(span(a) + span(b)).toBeCloseTo(2 * Math.PI - 2 * gap)
    expect(span(arcs([5], gap)[0])).toBeCloseTo(2 * Math.PI)
  })

  it('gives nothing-or-less an empty arc', () => {
    const [a, b, c] = arcs([2, 0, -1])
    expect(span(a)).toBeCloseTo(2 * Math.PI)
    expect(span(b)).toBe(0)
    expect(span(c)).toBe(0)
    expect(arcs([0, 0]).every((x) => span(x) === 0)).toBe(true)
  })
})

describe('arcPath', () => {
  it('draws a band between the radii, with the large-arc flag past half', () => {
    const quarter = arcPath(50, 50, 30, 40, { start: TOP, end: 0 })
    expect(
      quarter.startsWith('M50,10A40,40 0 0 1 90,50L80,50A30,30 0 0 0'),
    ).toBe(true)
    const most = arcPath(50, 50, 30, 40, { start: TOP, end: Math.PI })
    expect(most).toContain('A40,40 0 1 1')
  })

  it('draws a full ring in two halves, and nothing for an empty arc', () => {
    const full = arcPath(50, 50, 30, 40, { start: TOP, end: TOP + 2 * Math.PI })
    expect(full.match(/M/g)).toHaveLength(2)
    expect(arcPath(50, 50, 30, 40, { start: 1, end: 1 })).toBe('')
  })
})
