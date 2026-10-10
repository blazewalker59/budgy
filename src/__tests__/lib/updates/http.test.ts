import { describe, expect, it } from 'vitest'
import { BodyTooLarge, readLimited } from '@/lib/updates/http'

function stream(chunks: Array<Uint8Array>, cancel?: () => void) {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[i++]!)
    },
    cancel,
  })
}

const text = (value: string) => new TextEncoder().encode(value)

describe('readLimited', () => {
  it('joins chunks up to the byte cap and treats a missing body as empty', async () => {
    expect(await readLimited(null, 10)).toBe('')
    expect(await readLimited(stream([text('hé'), text('llo')]), 10)).toBe(
      'héllo',
    )
    expect(await readLimited(stream([text('abcd')]), 4)).toBe('abcd')
  })

  it('stops once the body passes the byte cap', async () => {
    let cancelled = false
    await expect(
      readLimited(
        stream([text('abcdef')], () => {
          cancelled = true
        }),
        4,
      ),
    ).rejects.toBeInstanceOf(BodyTooLarge)
    expect(cancelled).toBe(true)
  })

  it('refuses bytes that are not UTF-8', async () => {
    await expect(
      readLimited(stream([new Uint8Array([0xff])]), 10),
    ).rejects.toThrow()
    await expect(
      readLimited(stream([new Uint8Array([0xff])]), 10),
    ).rejects.not.toBeInstanceOf(BodyTooLarge)
  })
})
