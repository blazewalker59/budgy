import { afterEach, describe, expect, it, vi } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { serveMcp } from '@/lib/agents/endpoint'
import { createToken } from '@/lib/agents/tokens'
import { householdDatabase } from '@/lib/households/scope'
import { householdMembers, households, user } from '@/lib/db/schema'

// A database failure mid-request, as Drizzle reports it: the SQL and the
// values bound into it. Nothing else here can make a real query fail.
vi.mock('@/lib/households/locale', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  householdTimeZone: () =>
    Promise.reject(
      new Error('Failed query: select … params: alice@example.com', {
        cause: new Error('D1_ERROR: no such column'),
      }),
    ),
}))

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

describe('serveMcp', () => {
  it('logs only the kind of an unexpected failure, never its message', async () => {
    const { db, d1, sqlite } = testDatabase()
    open.push(sqlite)
    await db.insert(households).values({ id: 'a', name: 'A' })
    await db.insert(user).values({
      id: 'alice',
      name: 'Alice',
      email: 'alice@example.com',
      emailVerified: true,
    })
    await db
      .insert(householdMembers)
      .values({ householdId: 'a', memberId: 'alice', role: 'owner' })
    const { token } = await createToken(
      householdDatabase(db, 'a'),
      { id: 'alice', email: 'alice@example.com' },
      'Agent',
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await serveMcp(
      new Request('https://budgy.test/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
      { DB: d1, ALLOWED_EMAILS: 'alice@example.com' },
    )
    const logged = JSON.stringify(log.mock.calls)
    log.mockRestore()
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal error')
    expect(logged).toContain('Error(Error)')
    expect(logged).not.toContain('alice@example.com')
    expect(logged).not.toContain('Failed query')
  })
})
