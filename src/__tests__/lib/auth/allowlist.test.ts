import { describe, expect, it } from 'vitest'
import { allowedEmails, isAllowed } from '@/lib/auth/allowlist'

describe('allowlist', () => {
  const raw = ' Blaze@Example.com, alex@example.com ,,'

  it('normalizes the list', () => {
    expect([...allowedEmails(raw)]).toEqual([
      'blaze@example.com',
      'alex@example.com',
    ])
  })

  it('lets Members in, case-insensitively, and no one else', () => {
    expect(isAllowed('blaze@example.com', raw)).toBe(true)
    expect(isAllowed('ALEX@example.com', raw)).toBe(true)
    expect(isAllowed('stranger@example.com', raw)).toBe(false)
    expect(isAllowed(null, raw)).toBe(false)
  })

  it('lets no one in when unset', () => {
    expect(isAllowed('blaze@example.com', undefined)).toBe(false)
    expect(isAllowed('', '')).toBe(false)
  })
})
