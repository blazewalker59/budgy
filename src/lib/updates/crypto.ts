/** AES-GCM ciphertext cannot be moved between Households or connections. */
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
    throw new Error('Bank connection encryption is not configured')
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
    throw new Error(
      'Couldn’t open this connection. Disconnect it and connect again.',
    )
  }
}
