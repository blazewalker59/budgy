import { describe, expect, it } from 'vitest'
import { hashToken, newToken } from '@/lib/agents/tokens'
import { sha1Hex } from '@/lib/import/rows'
import {
  authorizationBearer,
  digestHex,
  prefixedToken,
  randomToken,
} from '@/lib/secret'

describe('shared secrets', () => {
  it('draws URL-safe tokens whose prefix is not sliced off another kind', () => {
    const invite = randomToken()
    expect(invite).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomToken()).not.toBe(invite)

    const agent = prefixedToken('bg_')
    const upload = prefixedToken('bu_')
    expect(agent).toMatch(/^bg_[A-Za-z0-9_-]{43}$/)
    expect(upload).toMatch(/^bu_[A-Za-z0-9_-]{43}$/)
    expect(newToken()).toMatch(/^bg_[A-Za-z0-9_-]{43}$/)
    expect(agent.slice(0, 3)).toBe('bg_')
    expect(upload.slice(0, 3)).toBe('bu_')
  })

  it('hashes with the same SHA-256 and SHA-1 as before', async () => {
    expect(await digestHex('SHA-256', '')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(await digestHex('SHA-256', 'bg_abc')).toBe(
      '4e3bbb4c230bd10505ffa56e6e7364f39ef79e5201f1a0d7360cf117b6413f7e',
    )
    expect(await hashToken('bg_abc')).toBe(await digestHex('SHA-256', 'bg_abc'))
    expect(await digestHex('SHA-1', '')).toBe(
      'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    )
    expect(await sha1Hex('hello')).toBe(
      'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    )
  })

  it('reads one Bearer credential, and can require a prefix', () => {
    expect(authorizationBearer('Bearer bu_abc')).toBe('bu_abc')
    expect(authorizationBearer('bearer   bg_abc')).toBe('bg_abc')
    expect(authorizationBearer('Basic bg_abc')).toBeNull()
    expect(authorizationBearer(null)).toBeNull()
    expect(authorizationBearer('Bearer bu_abc', 'bg_')).toBeNull()
    expect(authorizationBearer('Bearer bg_abc', 'bg_')).toBe('bg_abc')
  })
})
