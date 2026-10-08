import { describe, expect, it } from 'vitest'
import { bearerToken, hashToken, newToken } from '@/lib/agents/tokens'

describe('API tokens', () => {
  it('are long, random and URL-safe', () => {
    const a = newToken()
    expect(a).toMatch(/^bg_[A-Za-z0-9_-]{43}$/)
    expect(newToken()).not.toBe(a)
  })

  it('are stored as their SHA-256', async () => {
    expect(await hashToken('bg_abc')).toBe(await hashToken('bg_abc'))
    expect(await hashToken('bg_abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashToken('bg_abc')).not.toBe(await hashToken('bg_abd'))
  })

  it('come only from a Bearer header with our prefix', () => {
    expect(bearerToken('Bearer bg_abc')).toBe('bg_abc')
    expect(bearerToken('bearer   bg_abc')).toBe('bg_abc')
    expect(bearerToken('Bearer xyz')).toBeNull()
    expect(bearerToken('Basic bg_abc')).toBeNull()
    expect(bearerToken(null)).toBeNull()
  })
})
