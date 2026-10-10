/**
 * Random secrets, their digests, and the Bearer credential on a request.
 * Agent tokens, Shortcut upload tokens, and Household invitations all use
 * this, so a token issued before the sharing still verifies.
 */

/** `bytes` random bytes as base64url, without padding. 32 bytes is 43 characters. */
export function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...raw))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

/** `prefix` plus {@link randomToken}. The prefix is not sliced off another token. */
export function prefixedToken(prefix: string, bytes = 32): string {
  return prefix + randomToken(bytes)
}

/** Lower-case hex of `text` under `algorithm`. */
export async function digestHex(
  algorithm: 'SHA-1' | 'SHA-256',
  text: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    algorithm,
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The credential from an `Authorization: Bearer …` header.
 * With `prefix`, only a credential that starts with it.
 */
export function authorizationBearer(
  header: string | null,
  prefix?: string,
): string | null {
  const token = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null
  if (!token) return null
  if (prefix !== undefined && !token.startsWith(prefix)) return null
  return token
}
