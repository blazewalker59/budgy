import { describe, expect, it } from 'vitest'
import { startInstance } from '@/start'

/** Run Start's request middleware on a server-function request. */
async function serverFn(headers: Record<string, string>) {
  const options = await startInstance.getOptions()
  const [csrf] = options.requestMiddleware ?? []
  const server = (
    csrf as unknown as {
      options: {
        server: (ctx: Record<string, unknown>) => Promise<unknown>
      }
    }
  ).options.server
  const request = new Request('https://budgy.bid/_serverFn/abc', {
    method: 'POST',
    headers,
  })
  const result = await server({
    request,
    pathname: '/_serverFn/abc',
    handlerType: 'serverFn',
    context: {},
    next: () => Promise.resolve('allowed'),
  })
  return result instanceof Response ? result.status : result
}

describe('server functions', () => {
  it('accept same-origin requests from Budgy’s own pages', async () => {
    expect(await serverFn({ 'sec-fetch-site': 'same-origin' })).toBe('allowed')
    expect(await serverFn({ origin: 'https://budgy.bid' })).toBe('allowed')
  })

  it('refuse another site, or a request that says nothing of where it came from', async () => {
    expect(await serverFn({ 'sec-fetch-site': 'cross-site' })).toBe(403)
    expect(await serverFn({ origin: 'https://evil.example' })).toBe(403)
    expect(await serverFn({ origin: 'https://www.budgy.bid' })).toBe(403)
    // Browsers always send one of these; nothing else calls server functions.
    expect(await serverFn({})).toBe(403)
  })
})
