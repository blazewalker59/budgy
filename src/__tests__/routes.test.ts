import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROUTES = join(__dirname, '..', 'routes')

describe('route files', () => {
  it('never ship the router plugin’s placeholder ("Hello /route!")', () => {
    // A new route file can be stubbed by the dev server's router plugin
    // before its real content lands; this once shipped /admin as a stub.
    const stubs = readdirSync(ROUTES)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /Hello "\//.test(readFileSync(join(ROUTES, f), 'utf8')))
    expect(stubs).toEqual([])
  })
})
