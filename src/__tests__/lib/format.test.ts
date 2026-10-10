import { describe, expect, it } from 'vitest'
import { MIX_COLORS, ownerColor } from '@/lib/format'

describe('ownerColor', () => {
  it('picks a stable palette color for every name', () => {
    for (const name of ['Joint', 'Blaze', 'Alex', 'Sam', 'Riley']) {
      expect(MIX_COLORS).toContain(ownerColor(name))
      expect(ownerColor(name)).toBe(ownerColor(name))
    }
    expect(
      new Set(['Joint', 'Blaze', 'Alex', 'Sam'].map(ownerColor)).size,
    ).toBe(4)
  })
})
