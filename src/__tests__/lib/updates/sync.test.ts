/**
 * SimpleFIN history, connection health and single-account retries
 * (docs/adr/0014), against a fake Bridge that honours start-date, end-date
 * and account the way the real one does.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import type { SyncMessage } from '@/lib/updates/syncQueue'
import { householdDatabase } from '@/lib/households/scope'
import {
  accountUpdates,
  bankAccounts,
  bankConnections,
  households,
  moneyIn,
  transactions,
} from '@/lib/db/schema'
import { saveAccount } from '@/lib/ledger/accounts'
import { HISTORY_DAYS, WINDOW_DAYS, syncConnection } from '@/lib/updates/sync'
import { queueFirstSync } from '@/lib/updates/syncQueue'
import {
  addBankAccounts,
  connectSimplefin,
  mapBankAccount,
} from '@/lib/updates/connections'
import { today as householdToday } from '@/lib/model/dates'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const ACCESS = 'https://user:secret@beta-bridge.simplefin.org/simplefin'
const SETUP = btoa('https://beta-bridge.simplefin.org/simplefin/claim/demo')
const DAY = 86_400
const now = Math.floor(Date.now() / 1000)
const daysAgo = (n: number) => now - n * DAY
const me = { email: 'a@example.com' }
const base = {
  owner: 'Joint',
  institution: null,
  closed: false,
  securedBy: null,
}

interface FakeAccount {
  id: string
  name: string
  balance: string
  /** Days ago, and amount (negative for money out). */
  history: Array<[number, string]>
}

interface Request {
  start: number | null
  end: number | null
  accounts: Array<string>
}

/** Bridge as the protocol describes it: a window, and maybe some accounts. */
function fakeBridge(accounts: Array<FakeAccount>) {
  const requests: Array<Request> = []
  const reply: {
    status?: number
    errlist?: Array<object>
    omit?: Array<string>
  } = {}
  const transport = ((url: string) => {
    if (url.includes('/claim/')) return Promise.resolve(new Response(ACCESS))
    const params = new URL(url).searchParams
    if (params.get('balances-only'))
      return Promise.resolve(
        Response.json({
          accounts: accounts.map(({ history: _, ...a }) => ({
            ...a,
            currency: 'USD',
            conn_id: 'CON-1',
          })),
        }),
      )
    const start = params.get('start-date')
    const end = params.get('end-date')
    const only = params.getAll('account')
    const request = {
      start: start ? Number(start) : null,
      end: end ? Number(end) : null,
      accounts: only,
    }
    requests.push(request)
    if (reply.status)
      return Promise.resolve(new Response('', { status: reply.status }))
    return Promise.resolve(
      Response.json({
        errlist: reply.errlist ?? [],
        connections: [{ conn_id: 'CON-1', name: 'Chase', org_name: 'Chase' }],
        accounts: accounts
          .filter((a) => !only.length || only.includes(a.id))
          .filter((a) => !reply.omit?.includes(a.id))
          .map((a) => ({
            id: a.id,
            name: a.name,
            conn_id: 'CON-1',
            currency: 'USD',
            balance: a.balance,
            'balance-date': now,
            transactions: a.history
              .map(([ago, amount], i) => ({
                id: `${a.id}-${ago}-${i}`,
                posted: daysAgo(ago),
                amount,
                description: Number(amount) < 0 ? `Shop ${ago}` : 'Payroll',
              }))
              .filter(
                (t) =>
                  (request.start === null || t.posted >= request.start) &&
                  (request.end === null || t.posted < request.end),
              ),
          })),
      }),
    )
  }) as typeof fetch
  return { transport, requests, reply }
}

/** Every `step` days back to `days` ago, a purchase. */
const spending = (days: number, step = 10): FakeAccount['history'] =>
  Array.from({ length: Math.floor(days / step) }, (_, i) => [
    i * step + 1,
    '-10.00',
  ])

async function fixture(bank: Array<FakeAccount>) {
  const { db, sqlite, newClient } = testDatabase()
  open.push(sqlite)
  await db.insert(households).values([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ])
  const a = householdDatabase(db, 'a')
  const b = householdDatabase(newClient(), 'b')
  await saveAccount(a, { name: 'Card', kind: 'credit', ...base }, true)
  await saveAccount(a, { name: 'Checking', kind: 'checking', ...base }, true)
  await saveAccount(b, { name: 'Card', kind: 'credit', ...base }, true)
  const bridge = fakeBridge(bank)
  const { id } = await connectSimplefin(
    a,
    me,
    { name: 'Bridge', setupToken: SETUP },
    KEY,
    bridge.transport,
  )
  const link = (providerId: string, account: string | null) =>
    mapBankAccount(a, { connectionId: id, providerId, account })
  const sync = () => syncConnection(a, id, KEY, bridge.transport)
  const row = async (providerId = 'ACT-1') =>
    (await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.providerId, providerId))
      .get())!
  const added = async (account = 'Card') =>
    (await db.select().from(transactions)).filter((t) => t.account === account)
      .length
  return { db, a, b, id, ...bridge, link, sync, row, added }
}

const card = (history: FakeAccount['history']): FakeAccount => ({
  id: 'ACT-1',
  name: 'Sapphire',
  balance: '-100.00',
  history,
})

describe('SimpleFIN history', () => {
  it('reads a new account back about six months, in windows of at most 90 days, newest first', async () => {
    const f = await fixture([card(spending(300))])
    await f.link('ACT-1', 'Card')
    await f.sync()
    expect(f.requests).toHaveLength(2)
    const [newest, older] = f.requests
    expect(newest.end).toBeNull()
    expect(now - newest.start!).toBeLessThanOrEqual(WINDOW_DAYS * DAY)
    expect(older.end).toBe(newest.start)
    expect(older.end! - older.start!).toBeLessThanOrEqual(WINDOW_DAYS * DAY)
    expect(now - older.start!).toBeLessThanOrEqual(HISTORY_DAYS * DAY)
    // Just this account each time: Bridge's per-account requests.
    expect(f.requests.map((r) => r.accounts)).toEqual([['ACT-1'], ['ACT-1']])
    // Purchases every 10 days back to day 171; nothing older than the cap.
    expect(await f.added()).toBe(18)
    expect(await f.row()).toMatchObject({ historyComplete: true })
    // Each window is its own receipt, like any sync.
    const receipts = await f.db.select().from(accountUpdates)
    expect(receipts.map((r) => [r.source, r.status, r.added])).toEqual([
      ['simplefin', 'succeeded', 9],
      ['simplefin', 'succeeded', 9],
    ])
  })

  it('stops when a window comes back empty: the bank has no older history', async () => {
    const empty = await fixture([card([])])
    await empty.link('ACT-1', 'Card')
    await empty.sync()
    expect(empty.requests).toHaveLength(1)
    expect(await empty.row()).toMatchObject({ historyComplete: true })

    const short = await fixture([card(spending(60, 5))])
    await short.link('ACT-1', 'Card')
    await short.sync()
    // The older window had nothing at all; after that, routine syncs only.
    expect(short.requests).toHaveLength(2)
    expect(await short.row()).toMatchObject({ historyComplete: true })
    await short.sync()
    expect(short.requests).toHaveLength(3)
    expect(short.requests.at(-1)!.accounts).toEqual([])
  })

  it('leaves older history for tomorrow when today’s requests are nearly used, and resumes', async () => {
    const f = await fixture([card(spending(300))])
    await f.link('ACT-1', 'Card')
    const day = householdToday('America/New_York')
    await f.db
      .update(bankConnections)
      .set({ requestDay: day, requestCount: 15 })
    await f.sync()
    // The first window is its sync; the older one would dip into the reserve.
    expect(f.requests).toHaveLength(1)
    expect(await f.added()).toBe(9)
    const halfway = await f.row()
    expect(halfway.historyComplete).toBe(false)
    expect(halfway.syncedThrough).toBe(day)

    await f.db.update(bankConnections).set({ requestDay: '2000-01-01' })
    await f.sync()
    // A routine request, then the older window it left off at.
    expect(f.requests.slice(1).map((r) => [r.end, r.accounts])).toEqual([
      [null, []],
      [f.requests[0].start, ['ACT-1']],
    ])
    expect(await f.added()).toBe(18)
    expect(await f.row()).toMatchObject({ historyComplete: true })
  })

  it('adds nothing twice when history is read again, and brings Money in back as far', async () => {
    const f = await fixture([
      {
        id: 'CHK',
        name: 'Everyday',
        balance: '900.00',
        history: [
          [3, '-20.00'],
          [150, '2000.00'],
          [160, '-30.00'],
        ],
      },
    ])
    await f.link('CHK', 'Checking')
    await f.sync()
    expect(await f.added('Checking')).toBe(2)
    expect(await f.db.select().from(moneyIn)).toMatchObject([
      { account: 'Checking', amount: 200_000 },
    ])
    // Linking again starts its history afresh; source IDs keep it single.
    await f.link('CHK', null)
    await f.link('CHK', 'Checking')
    expect(await f.row('CHK')).toMatchObject({
      syncedThrough: null,
      historyFrom: null,
      historyComplete: false,
    })
    const results = await f.sync()
    expect(results.every((r) => !r.added && !r.moneyIn)).toBe(true)
    expect(await f.added('Checking')).toBe(2)
    expect(await f.db.select().from(moneyIn)).toHaveLength(1)
  })

  it('shares one request among accounts reading back from the same day', async () => {
    const f = await fixture([
      card(spending(300)),
      {
        id: 'CHK',
        name: 'Everyday',
        balance: '1.00',
        history: spending(300, 15),
      },
    ])
    await addBankAccounts(f.a, [
      { connectionId: f.id, providerId: 'ACT-1', link: 'Card' },
      { connectionId: f.id, providerId: 'CHK', link: 'Checking' },
    ])
    await f.sync()
    expect(f.requests.map((r) => r.accounts)).toEqual([
      ['ACT-1', 'CHK'],
      ['ACT-1', 'CHK'],
    ])
  })
})

describe('Queueing a first sync on linking', () => {
  function queue() {
    const sent: Array<{ body: SyncMessage; delaySeconds?: number }> = []
    return {
      sent,
      queue: {
        send: (body: SyncMessage, options?: { delaySeconds?: number }) => {
          sent.push({ body, delaySeconds: options?.delaySeconds })
          return Promise.resolve()
        },
      } as unknown as Queue<SyncMessage>,
    }
  }

  it('queues one sync per connection for links made together, without secrets', async () => {
    const f = await fixture([card([])])
    const q = queue()
    expect(await queueFirstSync(f.a, [f.id, f.id], q.queue)).toBe(1)
    expect(await queueFirstSync(f.a, [f.id], q.queue)).toBe(0)
    expect(q.sent).toEqual([
      { body: { householdId: 'a', connectionId: f.id }, delaySeconds: 30 },
    ])
    expect(JSON.stringify(q.sent)).not.toMatch(/secret|simplefin\.org/)
    // Once that sync is due, another link queues another.
    await f.db.update(bankConnections).set({ syncQueuedUntil: new Date(0) })
    expect(await queueFirstSync(f.a, [f.id], q.queue)).toBe(1)
  })

  it('queues nothing for another Household’s connection, or without a queue', async () => {
    const f = await fixture([card([])])
    const q = queue()
    expect(await queueFirstSync(f.b, [f.id], q.queue)).toBe(0)
    expect(await queueFirstSync(f.a, [f.id], undefined)).toBe(0)
    expect(q.sent).toEqual([])
  })
})
