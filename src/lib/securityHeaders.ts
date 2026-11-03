/**
 * Security headers on every response the Worker makes (src/server.ts).
 *
 * Scripts run only from this origin or with the request's nonce: TanStack
 * Start puts the nonce on its own inline hydration scripts and asset tags
 * (router `ssr.nonce`, src/router.tsx), and the root document on the theme
 * boot scripts. Styles may be inline (React style attributes), and the
 * Figtree font comes from Google Fonts (src/styles.css). Google
 * sign-in is a top-level navigation, not a form post or a frame, so it needs
 * nothing here; Google profile pictures are the only images from elsewhere.
 */
import { randomToken } from '@/lib/secret'

/** A fresh CSP nonce, for one response. */
export function newNonce(): string {
  return randomToken(16)
}

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https://*.googleusercontent.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

const PERMISSIONS = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'browsing-topics=()',
].join(', ')

/** An invitation link must never leak through a Referer (docs/adr/0008). */
const NO_REFERRER = /^\/join\//

/** The response with Budgy's security headers, keeping any it already set. */
export function withSecurityHeaders(
  response: Response,
  request: Request,
  nonce: string,
): Response {
  // Upgrade responses (WebSockets) can't be rebuilt; Budgy makes none.
  if (response.status === 101) return response
  const url = new URL(request.url)
  const secured = new Response(response.body, response)
  const set = (name: string, value: string) => {
    if (!secured.headers.has(name)) secured.headers.set(name, value)
  }
  if (url.protocol === 'https:')
    set('strict-transport-security', 'max-age=63072000; includeSubDomains')
  set('content-security-policy', contentSecurityPolicy(nonce))
  set('x-content-type-options', 'nosniff')
  set('x-frame-options', 'DENY')
  set(
    'referrer-policy',
    NO_REFERRER.test(url.pathname)
      ? 'no-referrer'
      : 'strict-origin-when-cross-origin',
  )
  set('permissions-policy', PERMISSIONS)
  return secured
}
