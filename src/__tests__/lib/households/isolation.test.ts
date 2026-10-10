import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import { householdDatabase, householdRow } from '@/lib/households/scope'
import { memberHousehold, requireHousehold } from '@/lib/households/membership'
import {
  loadLedger,
  moveTransaction,
  noteTransaction,
} from '@/lib/ledger/queries'
import {
  clearBalances,
  deleteAccount,
  deleteBalance,
  findAccount,
  postTransactions,
  recordBalances,
  removeStarting,
  saveAccount,
} from '@/lib/ledger/accounts'
import { loadImportRules } from '@/lib/ledger/importer'
import { createToken, verifyToken } from '@/lib/agents/tokens'
import { budgyTools } from '@/lib/agents/tools'
import { handleMcp } from '@/lib/agents/mcp'
import { serveMcp } from '@/lib/agents/endpoint'
import { serverRequestContext } from '@/lib/db'
import { withMember } from '@/lib/auth/session'
import {
  budgetTargets,
  categories,
  householdMembers,
  households,
  imports,
  paySchedules,
  plannedExpenses,
  savedLenses,
  settings,
  storeRules,
  transactions,
} from '@/lib/db/schema'

vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: {
      getSession: ({ headers }: { headers: Headers }) => {
        const id = headers.get('x-test-member')
        return Promise.resolve(
          id
            ? {
                user: {
                  id,
                  name: id,
                  email: `${id}@example.com`,
                  emailVerified: true,
                },
              }
            : null,
        )
      },
    },
  }),
}))

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

async function fixture() {
  const { db, sqlite, newClient, d1 } = testDatabase()
  open.push(sqlite)
  await db.insert(households).values([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ])
  await db.insert(householdMembers).values([
    { householdId: 'a', memberId: 'alice', role: 'owner' },
    { householdId: 'b', memberId: 'bob', role: 'owner' },
  ])
  const a = householdDatabase(db, 'a')
  // Each scope owns a distinct Drizzle instance, as production requests do.
  const b = householdDatabase(newClient(), 'b')
  for (const scope of [a, b]) {
    await saveAccount(
      scope,
      {
        name: 'Card',
        owner: 'Joint',
        kind: 'credit',
        institution: null,
        closed: false,
        securedBy: null,
      },
      true,
    )
    await scope
      .insert(categories)
      .values(
        householdRow(scope, { name: 'Food', tag: 'need', group: 'everyday' }),
      )
    await scope.insert(imports).values(
      householdRow(scope, {
        id: 'same-import',
        fileName: scope.householdId,
        account: null,
        importedBy: 'member',
        added: 1,
        skipped: 0,
      }),
    )
    await scope.insert(transactions).values(
      householdRow(scope, {
        id: 'same-id',
        date: '2026-10-01',
        month: '2026-10',
        account: 'Card',
        description: 'Coffee',
        store: 'Coffee',
        sourceCategory: 'Food',
        amount: scope.householdId === 'a' ? 500 : 900,
        importId: 'same-import',
      }),
    )
    await scope.insert(budgetTargets).values(
      householdRow(scope, {
        category: 'Food',
        startsMonth: '2026-10',
        amount: 1000,
      }),
    )
    await scope.insert(storeRules).values(
      householdRow(scope, {
        sourceCategory: 'Food',
        store: scope.householdId,
        category: 'Food',
      }),
    )
    await scope.insert(paySchedules).values(
      householdRow(scope, {
        id: 'same-pay',
        name: scope.householdId,
        amount: 1000,
        cadence: 'monthly',
        anchor: '2026-10-01',
      }),
    )
    await scope.insert(plannedExpenses).values(
      householdRow(scope, {
        id: 'same-plan',
        name: scope.householdId,
        category: 'Food',
        amount: 1000,
        cadence: 'monthly',
        anchor: '2026-10-01',
      }),
    )
    await scope.insert(savedLenses).values(
      householdRow(scope, {
        id: 'same-lens',
        name: scope.householdId,
        lens: {},
        createdBy: 'member',
      }),
    )
    await scope.insert(settings).values(
      householdRow(scope, {
        key: 'import_rules',
        value: JSON.stringify({ stores: [['Coffee', scope.householdId]] }),
      }),
    )
    await recordBalances(
      scope,
      [
        {
          account: 'Card',
          date: '2026-10-01',
          amount: scope.householdId === 'a' ? 500 : 900,
        },
      ],
      'member',
    )
  }
  return { a, b, db, sqlite, d1 }
}

describe('Household isolation', () => {
  it('derives request scope from verified membership, not a client Household header', async () => {
    const { d1 } = await fixture()
    const env = {
      DB: d1,
      ALLOWED_EMAILS: 'alice@example.com,bob@example.com,stranger@example.com',
    }
    const request = (id: string) =>
      serverRequestContext.run(
        {
          env,
          headers: new Headers({ 'x-test-member': id, 'x-household-id': 'b' }),
        },
        () => withMember(({ db }) => loadLedger(db)),
      )
    expect((await request('alice')).txns.map((t) => t.amount)).toEqual([500])
    expect((await request('bob')).txns.map((t) => t.amount)).toEqual([900])
    await expect(request('stranger')).rejects.toThrow('membership')
    await expect(request('not-allowed')).rejects.toThrow('Sign in required')
  })

  it('allows identical names and IDs while reading only the current Household', async () => {
    const { a, b } = await fixture()
    const first = await loadLedger(a)
    const second = await loadLedger(b)
    expect(first.txns.map((t) => t.amount)).toEqual([500])
    expect(second.txns.map((t) => t.amount)).toEqual([900])
    expect(first.balances.map((v) => v.amount)).toEqual([500])
    expect(first.rules.map((r) => r.store)).toEqual(['a'])
    expect(first.pay.map((p) => p.name)).toEqual(['a'])
    expect(first.plans.map((p) => p.name)).toEqual(['a'])
    expect(first.lenses.map((l) => l.name)).toEqual(['a'])
    expect(first.accounts).toHaveLength(1)
    expect(first.categories).toHaveLength(1)
    expect(first.targets).toHaveLength(1)
    expect((await loadImportRules(b)).stores).toEqual([['Coffee', 'b']])
  })

  it('keeps edits, balances, starting-purchase deletion and import cleanup isolated', async () => {
    const { a, b } = await fixture()
    await moveTransaction(a, 'same-id', 'Treats')
    await noteTransaction(a, 'same-id', 'Only A')
    await recordBalances(
      a,
      [{ account: 'Card', date: '2026-10-01', amount: 100 }],
      'alice',
    )
    expect((await loadLedger(b)).txns[0]).toMatchObject({
      category: null,
      note: null,
    })
    expect(
      (await loadLedger(b)).categories.some((c) => c.name === 'Treats'),
    ).toBe(false)
    expect(await removeStarting(a)).toBe(1)
    expect((await loadLedger(b)).txns).toHaveLength(1)
    expect(await b.select().from(imports)).toHaveLength(1)
    await clearBalances(a, 'Card')
    await deleteBalance(a, 'Card', '2026-10-01')
    await deleteAccount(a, 'Card')
    expect((await loadLedger(b)).balances[0].amount).toBe(900)
    expect(await findAccount(b, 'Card')).toMatchObject({ name: 'Card' })
  })

  it('does not use another Household’s history, rules, or duplicate IDs during imports', async () => {
    const { a, b } = await fixture()
    const row = { date: '2026-10-03', description: 'Coffee', amount: 4 }
    const first = await postTransactions(a, {
      account: 'Card',
      rows: [row],
      commit: true,
      importedBy: 'alice',
    })
    const second = await postTransactions(b, {
      account: 'Card',
      rows: [row],
      commit: true,
      importedBy: 'bob',
    })
    expect(first.added).toBe(1)
    expect(second.added).toBe(1)
    expect(
      (await loadLedger(a)).txns.find((t) => t.date === row.date)?.store,
    ).toBe('a')
    expect(
      (await loadLedger(b)).txns.find((t) => t.date === row.date)?.store,
    ).toBe('b')
    expect(
      (
        await postTransactions(a, {
          account: 'Card',
          rows: [row],
          commit: true,
          importedBy: 'alice',
        })
      ).added,
    ).toBe(0)
    await expect(
      recordBalances(
        a,
        [{ account: 'Missing', date: row.date, amount: 5 }],
        'alice',
      ),
    ).rejects.toThrow('No account')
  })

  it('fails closed without membership and prevents a second Household membership', async () => {
    const { db } = await fixture()
    await expect(requireHousehold(db, 'alice', 'b')).rejects.toThrow(
      'access denied',
    )
    await expect(memberHousehold(db, 'stranger')).rejects.toThrow('membership')
    await expect(
      db
        .insert(householdMembers)
        .values({ householdId: 'b', memberId: 'alice', role: 'member' }),
    ).rejects.toThrow()
    expect((await memberHousehold(db, 'alice')).id).toBe('a')
  })

  it('carries Moves and notes during replacement without touching a matching purchase elsewhere', async () => {
    const { a, b } = await fixture()
    await moveTransaction(a, 'same-id', 'Treats')
    await noteTransaction(a, 'same-id', 'Preserve me')
    const summary = await postTransactions(a, {
      account: 'Card',
      rows: [{ date: '2026-10-01', description: 'Coffee', amount: 5 }],
      commit: true,
      replaceStarting: true,
      importedBy: 'alice',
    })
    expect(summary.replaced).toBe(1)
    expect(summary.carried).toBe(1)
    expect((await loadLedger(a)).txns[0]).toMatchObject({
      category: 'Treats',
      note: 'Preserve me',
    })
    expect((await loadLedger(b)).txns[0]).toMatchObject({
      id: 'same-id',
      category: null,
      note: null,
      amount: 900,
    })
  })

  it('rejects unscoped reads and rebinding a database to another Household', async () => {
    const { db, sqlite } = testDatabase()
    open.push(sqlite)
    await expect(
      loadLedger(db as Parameters<typeof loadLedger>[0]),
    ).rejects.toThrow('Household required')
    householdDatabase(db, 'a')
    expect(() => householdDatabase(db, 'b')).toThrow('Cannot rebind')
  })

  it('binds MCP tokens to one Household and stops them when membership is removed', async () => {
    const { a, b, db, d1 } = await fixture()
    const token = await createToken(
      a,
      { id: 'alice', email: 'alice@example.com' },
      'Agent',
      ['read', 'write'],
    )
    const caller = await verifyToken(db, token.token)
    expect(caller?.householdId).toBe('a')
    expect(() => budgyTools(b, caller!, '2026-10-09')).toThrow('scope mismatch')
    const request = () =>
      new Request('https://budgy.example/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'x-household-id': 'b',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'get_daily_digest',
            arguments: { date: '2026-10-01' },
          },
        }),
      })
    const response = await serveMcp(request(), {
      DB: d1,
      ALLOWED_EMAILS: 'alice@example.com',
    })
    expect(response.status).toBe(200)
    const body = await response.text()
    const payload = JSON.parse(body) as {
      result: { content: Array<{ text: string }> }
    }
    const digest = JSON.parse(payload.result.content[0].text) as {
      transactions: Array<{ amount: number }>
    }
    expect(digest.transactions.map((t) => t.amount)).toEqual([5])
    const reply = await handleMcp(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'update_transaction',
          arguments: { id: 'same-id', note: 'MCP A' },
        },
      },
      budgyTools(a, caller!, '2026-10-09'),
      '',
    )
    expect(reply).toBeTruthy()
    expect((await loadLedger(a)).txns[0].note).toBe('MCP A')
    expect((await loadLedger(b)).txns[0].note).toBeNull()
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.memberId, 'alice'))
    expect(await verifyToken(db, token.token)).toBeNull()
    expect(
      (
        await serveMcp(request(), {
          DB: d1,
          ALLOWED_EMAILS: 'alice@example.com',
        })
      ).status,
    ).toBe(401)
  })
})

describe('Household migration', () => {
  it('preserves existing purchases, Moves, notes, balances, settings, and token credentials', async () => {
    const { db, sqlite } = testDatabase((old) => {
      old.exec(`
        INSERT INTO user (id, name, email) VALUES ('existing', 'Member', 'existing@example.com');
        INSERT INTO accounts (name, source_name, owner) VALUES ('Card', 'Card', 'Joint');
        INSERT INTO categories (name, tag, "group") VALUES ('Food', 'need', 'everyday');
        INSERT INTO imports (id, file_name, imported_by, added, skipped) VALUES ('im_old', 'old.csv', 'existing', 1, 0);
        INSERT INTO transactions (id, date, month, account, description, store, source_category, amount, category, note, import_id)
          VALUES ('old-id', '2026-10-01', '2026-10', 'Card', 'Coffee', 'Coffee', 'Food', 500, 'Treats', 'Keep this', 'im_old');
        INSERT INTO balances (account, date, amount, recorded_by) VALUES ('Card', '2026-10-01', 500, 'existing');
        INSERT INTO settings (key, value) VALUES ('import_rules', '{"stores":[["Coffee","Cafe"]]}');
        INSERT INTO api_tokens (id, member_id, member_email, name, token_hash, prefix, scopes, created_at)
          VALUES ('token', 'existing', 'existing@example.com', 'Agent', 'keep-hash', 'bg_abc', '["read"]', '2026-10-01');
      `)
    })
    open.push(sqlite)
    const household = await memberHousehold(db, 'existing')
    expect(household.id).toBe('hh_initial')
    const scope = await requireHousehold(db, 'existing', household.id)
    expect((await loadLedger(scope)).txns[0]).toMatchObject({
      id: 'old-id',
      category: 'Treats',
      note: 'Keep this',
      amount: 500,
    })
    expect((await loadLedger(scope)).balances[0].amount).toBe(500)
    expect((await loadImportRules(scope)).stores).toEqual([['Coffee', 'Cafe']])
    expect(
      sqlite.prepare('SELECT household_id, token_hash FROM api_tokens').get(),
    ).toMatchObject({ household_id: 'hh_initial', token_hash: 'keep-hash' })
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(() =>
      sqlite.exec(
        "INSERT INTO categories (name, tag, \"group\") VALUES ('Unsafe', 'need', 'everyday')",
      ),
    ).toThrow()
  })
})
