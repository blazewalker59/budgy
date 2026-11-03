/**
 * Workers Rate Limiting for the token endpoints (`/mcp`, the Shortcut
 * upload). Each caller is counted by IP and, when it sent a well-formed
 * token, by that token's hash too, so a runaway Agent is held back even
 * behind a shared address. Counts are per Cloudflare location and
 * approximate: a brake on floods and loops, not an accounting system.
 *
 * Without the binding (local dev, tests) or if it fails, requests go through:
 * the endpoints still authenticate every request.
 */
import { digestHex } from '@/lib/secret'

export async function overRateLimit(
  limiter: RateLimit | undefined,
  request: Request,
  token: string | null,
): Promise<boolean> {
  if (!limiter) return false
  const keys: Array<string> = []
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) keys.push(`ip:${ip}`)
  if (token) keys.push(`token:${await digestHex('SHA-256', token)}`)
  try {
    for (const key of keys) {
      const { success } = await limiter.limit({ key })
      if (!success) return true
    }
  } catch {
    // Fail open: a limiter outage shouldn't take the endpoints down.
  }
  return false
}

export function tooManyRequests(): Response {
  return new Response('Too many requests. Try again in a minute.', {
    status: 429,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '60',
    },
  })
}
