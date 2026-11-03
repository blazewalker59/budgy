import { describe, expect, it } from 'vitest'
import {
  contentSecurityPolicy,
  newNonce,
  withSecurityHeaders,
} from '@/lib/securityHeaders'
import { serveMcp } from '@/lib/agents/endpoint'

const page = (path: string, origin = 'https://budgy.bid') =>
  new Request(`${origin}${path}`)

describe('withSecurityHeaders', () => {
  it('secures an HTML page, allowing only this response’s inline scripts', async () => {
    const nonce = newNonce()
    const response = withSecurityHeaders(
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
      page('/accounts'),
      nonce,
    )
    const csp = response.headers.get('content-security-policy')!
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`)
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    for (const directive of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ])
      expect(csp).toContain(directive)
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'strict-transport-security': 'max-age=63072000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-type': 'text/html; charset=utf-8',
    })
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
    expect(await response.text()).toBe('<html></html>')
  })

  it('never sends an invitation link as a Referer', () => {
    const response = withSecurityHeaders(
      new Response('ok'),
      page('/join/abc'),
      newNonce(),
    )
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('adds headers to a redirect, whose own headers are immutable', () => {
    const response = withSecurityHeaders(
      Response.redirect('https://budgy.bid/', 308),
      page('/', 'https://www.budgy.bid'),
      newNonce(),
    )
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('https://budgy.bid/')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  it('secures the token endpoints’ replies too', async () => {
    const reply = await serveMcp(
      new Request('https://budgy.bid/mcp', { method: 'GET' }),
      { DB: undefined as unknown as D1Database },
    )
    const response = withSecurityHeaders(reply, page('/mcp'), newNonce())
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('keeps a header a response set itself, and skips HSTS over plain HTTP', () => {
    const response = withSecurityHeaders(
      new Response('ok', { headers: { 'referrer-policy': 'same-origin' } }),
      page('/', 'http://localhost:3000'),
      newNonce(),
    )
    expect(response.headers.get('referrer-policy')).toBe('same-origin')
    expect(response.headers.has('strict-transport-security')).toBe(false)
  })
})

describe('newNonce', () => {
  it('is fresh and unguessable for each response', () => {
    const a = newNonce()
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(newNonce()).not.toBe(a)
    expect(contentSecurityPolicy(a)).toContain(`'nonce-${a}'`)
  })
})
