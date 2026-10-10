/** Real SQLite behind the D1 calls Drizzle uses, including transactional batches. */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SQLInputValue } from 'node:sqlite'
import { dbFromD1 } from '@/lib/db'

export function testDatabase(beforeIsolation?: (sqlite: DatabaseSync) => void) {
  const sqlite = new DatabaseSync(':memory:')
  const directory = resolve('drizzle')
  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (file === '0010_household_isolation.sql') beforeIsolation?.(sqlite)
    sqlite.exec(readFileSync(resolve(directory, file), 'utf8'))
  }
  function prepare(sql: string) {
    let params: Array<SQLInputValue> = []
    return {
      bind(...values: Array<SQLInputValue>) {
        if (values.length > 100) throw new Error('D1 variable limit exceeded')
        params = values
        return this
      },
      executeAll() {
        return {
          results: sqlite.prepare(sql).all(...params),
          success: true,
        }
      },
      all() {
        return Promise.resolve(this.executeAll())
      },
      raw() {
        const statement = sqlite.prepare(sql)
        statement.setReturnArrays(true)
        return Promise.resolve(statement.all(...params))
      },
      run() {
        const result = sqlite.prepare(sql).run(...params)
        return Promise.resolve({
          results: [],
          success: true,
          meta: { changes: result.changes },
        })
      },
    }
  }
  const d1 = {
    prepare,
    batch(statements: Array<ReturnType<typeof prepare>>) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(statement.executeAll())
        sqlite.exec('COMMIT')
        return Promise.resolve(results)
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { db: dbFromD1(d1), sqlite, d1, newClient: () => dbFromD1(d1) }
}
