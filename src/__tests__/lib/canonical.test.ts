import { describe, expect, it } from 'vitest'
import { canonicalRedirect } from '@/lib/canonical'

describe('canonicalRedirect', () => {
  it('sends www and workers.dev to the same path on budgy.bid', () => {
    for (const host of ['www.budgy.bid', 'budgy.example.workers.dev']) {
      const r = canonicalRedirect(
        new URL(`https://${host}/spending?people=%5B%22Alex%22%5D`),
        'GET',
        'budgy.bid',
      )!
      expect(r.status).toBe(301)
      expect(r.headers.get('location')).toBe(
        'https://budgy.bid/spending?people=%5B%22Alex%22%5D',
      )
    }
  })

  it('keeps the method for an Agent’s POST or a sign-in', () => {
    expect(
      canonicalRedirect(
        new URL('https://www.budgy.bid/mcp'),
        'POST',
        'budgy.bid',
      )!.status,
    ).toBe(308)
  })

  it('moves plain http to https', () => {
    const r = canonicalRedirect(
      new URL('http://budgy.bid/plan'),
      'GET',
      'budgy.bid',
    )!
    expect(r.headers.get('location')).toBe('https://budgy.bid/plan')
  })

  it('leaves budgy.bid and local development alone', () => {
    expect(
      canonicalRedirect(new URL('https://budgy.bid/'), 'GET', 'budgy.bid'),
    ).toBeNull()
    expect(
      canonicalRedirect(new URL('http://localhost:3010/'), 'GET', undefined),
    ).toBeNull()
  })
})
