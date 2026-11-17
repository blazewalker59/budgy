import { describe, expect, it } from 'vitest'
import { niceTicks, niceTicksBetween } from '@/lib/layout/ticks'

describe('niceTicks', () => {
  it('steps in round numbers to just past the top', () => {
    expect(niceTicks(1_360_000)).toEqual([0, 500_000, 1_000_000, 1_500_000])
    expect(niceTicks(731_300)).toEqual([0, 200_000, 400_000, 600_000, 800_000])
    expect(niceTicks(90)).toEqual([0, 25, 50, 75, 100])
  })

  it('ends exactly on a round top', () => {
    expect(niceTicks(800_000)).toEqual([0, 200_000, 400_000, 600_000, 800_000])
  })

  it('still draws an axis with nothing to show', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(Number.NaN)).toEqual([0, 1])
  })
})

describe('niceTicksBetween', () => {
  it('covers below zero too, always through zero', () => {
    expect(niceTicksBetween(-230_000, 910_000)).toEqual([
      -500_000, 0, 500_000, 1_000_000,
    ])
    expect(niceTicksBetween(-1_130_000, -20_000)).toEqual([
      -1_500_000, -1_000_000, -500_000, 0,
    ])
  })

  it('keeps zero in view when everything is above it', () => {
    expect(niceTicksBetween(400, 900)[0]).toBe(0)
  })

  it('still draws an axis with nothing to show', () => {
    expect(niceTicksBetween(0, 0)).toEqual([0, 1])
    expect(niceTicksBetween(Number.NaN, Number.NaN)).toEqual([0, 1])
  })
})
