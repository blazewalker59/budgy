/**
 * AES-GCM encryption of bank connection credentials under
 * BANK_CONNECTION_KEY. Ciphertext cannot be moved between Households or
 * connections. During a key rotation, BANK_CONNECTION_KEY_PREVIOUS still
 * opens what the old key sealed, and each one is sealed again under the
 * current key the next time it is used (docs/adr/0010).
 */
import { UserError } from '@/lib/errors'

/**
 * The keys a credential may be under: one key, or during a rotation the
 * current key and the previous one.
 */
export type BankKeys =
  string | undefined | { current?: string; previous?: string }

export function bankKeys(env: {
  BANK_CONNECTION_KEY?: string
  BANK_CONNECTION_KEY_PREVIOUS?: string
}): BankKeys {
  return {
    current: env.BANK_CONNECTION_KEY,
    previous: env.BANK_CONNECTION_KEY_PREVIOUS,
  }
}

/** The key new ciphertext is sealed with. */
export function currentKey(keys: BankKeys): string | undefined {
  return typeof keys === 'object' ? keys.current : keys
}

function previousKey(keys: BankKeys): string | undefined {
  return typeof keys === 'object' ? keys.previous : undefined
}

function bytes(text: string) {
  return Uint8Array.from(
    atob(text.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  )
}
function base64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
}

export function connectionKeyReady(secret?: string) {
  try {
    return Boolean(secret && bytes(secret).length === 32)
  } catch {
    return false
  }
}
async function key(secret?: string) {
  if (!connectionKeyReady(secret))
    throw new UserError('Bank connection encryption is not configured')
  return crypto.subtle.importKey('raw', bytes(secret!), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}
export async function encryptAccess(
  value: string,
  secret: string | undefined,
  context: string,
) {
  const imported = await key(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    imported,
    new TextEncoder().encode(value),
  )
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`
}

const UNREADABLE =
  'Couldn’t open this connection. Disconnect it and connect again.'

export async function decryptAccess(
  value: string,
  secret: string | undefined,
  context: string,
) {
  try {
    const [version, iv, ciphertext, extra] = value.split('.')
    if (
      version !== 'v1' ||
      !iv ||
      !ciphertext ||
      extra ||
      bytes(iv).length !== 12
    )
      throw new Error('Invalid ciphertext')
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes(iv),
        additionalData: new TextEncoder().encode(context),
      },
      await key(secret),
      bytes(ciphertext),
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    throw new UserError(UNREADABLE)
  }
}

/**
 * Open a credential with the current key, else the previous one. `resealed`
 * is the same credential under the current key, when it was under the
 * previous one, for the caller to store.
 */
export async function openAccess(
  value: string,
  keys: BankKeys,
  context: string,
): Promise<{ access: string; resealed?: string }> {
  const current = currentKey(keys)
  try {
    return { access: await decryptAccess(value, current, context) }
  } catch (error) {
    const previous = previousKey(keys)
    if (!previous || previous === current) throw error
  }
  const access = await decryptAccess(value, previousKey(keys), context)
  return { access, resealed: await encryptAccess(access, current, context) }
}
