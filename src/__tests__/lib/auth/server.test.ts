import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { getAuth } from '@/lib/auth/server'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

describe('getAuth', () => {
  it('never links a Google identity to an existing user', () => {
    const { d1, sqlite } = testDatabase()
    open.push(sqlite)
    const auth = getAuth({
      DB: d1,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
    })
    expect(auth.options.account?.accountLinking).toEqual({ enabled: false })
  })
})
