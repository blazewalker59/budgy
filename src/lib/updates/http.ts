export class BodyTooLarge extends Error {
  constructor() {
    super('Response or upload is too large')
  }
}

/** Enforce byte limits while reading, not after buffering an arbitrary body. */
export async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
) {
  if (!body) return ''
  const reader = body.getReader()
  const parts: Array<Uint8Array> = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maximum) {
        await reader.cancel()
        throw new BodyTooLarge()
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
