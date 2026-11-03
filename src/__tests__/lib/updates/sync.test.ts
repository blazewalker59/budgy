/**
 * SimpleFIN history, connection health and single-account retries
 * (docs/adr/0014), against a fake Bridge that honours start-date, end-date
 * and account the way the real one does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import {
  consumeSyncBatch,
  enqueueSyncs,
  queueFirstSync,
} from '@/lib/updates/syncQueue'
import { listAccountUpdates } from '@/lib/updates/queries'
import {
  addBankAccounts,
  connectSimplefin,
  listConnections,
  mapBankAccount,
  reconnectSimplefin,
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
  const { db, sqlite, newClient, d1 } = testDatabase()
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
  return { db, d1, a, b, id, ...bridge, link, sync, row, added }
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

/** A queue batch of one message, recording how it was settled. */
function batchOf(body: unknown, attempts = 1) {
  const settled: { acked?: true; retry?: number } = {}
  const batch = {
    queue: 'budgy-sync',
    messages: [
      {
        id: 'm1',
        timestamp: new Date(),
        body,
        attempts,
        ack: () => (settled.acked = true),
        retry: (options?: { delaySeconds?: number }) =>
          (settled.retry = options?.delaySeconds ?? 0),
      },
    ],
  } as unknown as MessageBatch
  return { batch, settled }
}

const checking: FakeAccount = {
  id: 'CHK',
  name: 'Everyday',
  balance: '500.00',
  history: [[2, '-5.00']],
}

describe('SimpleFIN connection health', () => {
  it('pauses a connection whose subscription lapsed, says how to renew, and doesn’t retry it', async () => {
    const f = await fixture([card([[2, '-1.00']])])
    await f.link('ACT-1', 'Card')
    f.reply.status = 402
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { batch, settled } = batchOf({ householdId: 'a', connectionId: f.id })
    await consumeSyncBatch(f.d1, batch, KEY, f.transport)
    expect(settled).toEqual({ acked: true })
    const [connection] = await listConnections(f.a)
    expect(connection.status).toBe('payment_required')
    expect(connection.lastError).toContain('https://bridge.simplefin.org/')
    // Still asked on schedule, so it resumes once renewed.
    const sent: Array<unknown> = []
    const queue = {
      sendBatch: (m: Iterable<{ body: unknown }>) => {
        for (const x of m) sent.push(x.body)
        return Promise.resolve()
      },
    } as unknown as Queue<SyncMessage>
    expect(await enqueueSyncs(f.d1, queue)).toBe(1)
    f.reply.status = undefined
    await f.sync()
    expect((await listConnections(f.a))[0].status).toBe('ready')
    log.mockRestore()
  })

  it('keeps a revoked connection’s credential and links, doesn’t retry it, and stops scheduling it', async () => {
    const f = await fixture([card([[2, '-1.00']])])
    await f.link('ACT-1', 'Card')
    f.reply.status = 403
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { batch, settled } = batchOf({ householdId: 'a', connectionId: f.id })
    await consumeSyncBatch(f.d1, batch, KEY, f.transport)
    log.mockRestore()
    expect(settled).toEqual({ acked: true })
    const [connection] = await listConnections(f.a)
    expect(connection.status).toBe('revoked')
    expect(connection.lastError).toMatch(/new setup token/)
    expect(connection.accounts[0].account).toBe('Card')
    const stored = await f.db.select().from(bankConnections).get()
    expect(stored!.encryptedAccess).toBeTruthy()
    const queue = {
      sendBatch: () => Promise.resolve(),
    } as unknown as Queue<SyncMessage>
    expect(await enqueueSyncs(f.d1, queue)).toBe(0)
  })

  it('marks accounts whose bank needs a new sign-in, and reads their window again once fixed', async () => {
    const f = await fixture([card([[2, '-1.00']]), checking])
    await f.link('ACT-1', 'Card')
    await f.sync()
    const before = (await f.row()).syncedThrough
    await f.db
      .update(bankAccounts)
      .set({ syncedThrough: '2026-01-01' })
      .where(eq(bankAccounts.providerId, 'ACT-1'))
    f.reply.errlist = [
      { code: 'con.auth', msg: 'Chase wants you to log in', conn_id: 'CON-1' },
    ]
    const [result] = await f.sync()
    expect(result.error).toBe(
      'Chase needs you to sign in again in SimpleFIN Bridge. SimpleFIN says: Chase wants you to log in',
    )
    expect(result.retry).toBeUndefined()
    expect(await f.row()).toMatchObject({
      syncedThrough: '2026-01-01',
      problemKind: 'reauth',
    })
    const [update] = await listAccountUpdates(f.a)
    expect(update.latest).toMatchObject({
      status: 'attention',
      message: expect.stringContaining('sign in again'),
    })
    f.reply.errlist = []
    await f.sync()
    expect(await f.row()).toMatchObject({
      syncedThrough: before,
      problem: null,
      problemKind: null,
    })
  })

  it('holds back an account Bridge couldn’t fully read, and offers to retry it alone', async () => {
    const f = await fixture([card([[2, '-1.00']]), checking])
    await f.link('ACT-1', 'Card')
    await f.link('CHK', 'Checking')
    await f.sync()
    await f.db.update(bankAccounts).set({ syncedThrough: '2026-01-01' })
    f.reply.errlist = [
      { code: 'act.weird-new-code', msg: 'Try later', account_id: 'ACT-1' },
    ]
    const results = await f.sync()
    expect(results.find((r) => r.account === 'Card')).toMatchObject({
      retry: 'ACT-1',
      error: expect.stringContaining('SimpleFIN says: Try later'),
    })
    expect(await f.row()).toMatchObject({
      syncedThrough: '2026-01-01',
      problemKind: 'failed',
    })
    // The other account isn't held back.
    expect((await f.row('CHK')).syncedThrough).not.toBe('2026-01-01')
    expect((await f.row('CHK')).problem).toBeNull()
  })

  it('records a failed check for an account missing from the reply', async () => {
    const f = await fixture([card([[2, '-1.00']])])
    await f.link('ACT-1', 'Card')
    await f.sync()
    f.reply.omit = ['ACT-1']
    const [result] = await f.sync()
    expect(result).toMatchObject({ account: 'Card', retry: 'ACT-1' })
    expect(await f.row()).toMatchObject({ problemKind: 'missing' })
    const [update] = await listAccountUpdates(f.a)
    expect(update.latest).toMatchObject({
      status: 'failed',
      message:
        'SimpleFIN didn’t send Sapphire this time. Budgy will try it again.',
    })
    // The last success is still the one before.
    expect(update.success?.status).toBe('succeeded')
  })

  it('shows a plain message for Bridge’s developer errors, never their text', async () => {
    const f = await fixture([card([[2, '-1.00']])])
    await f.link('ACT-1', 'Card')
    f.reply.errlist = [{ code: 'gen.api', msg: 'start-date=17 is wrong' }]
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await f.sync()
    log.mockRestore()
    const [connection] = await listConnections(f.a)
    expect(connection.status).toBe('attention')
    expect(connection.lastError).toContain('couldn’t answer Budgy’s request')
    expect(connection.lastError).not.toContain('start-date')
  })

  it('treats gen.auth like revoked access', async () => {
    const f = await fixture([card([[2, '-1.00']])])
    await f.link('ACT-1', 'Card')
    f.reply.errlist = [{ code: 'gen.auth', msg: 'nope' }]
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(f.sync()).rejects.toThrow(/no longer accepts/)
    log.mockRestore()
    expect((await listConnections(f.a))[0].status).toBe('revoked')
  })
})

describe('Reconnecting with a new setup token', () => {
  const NEW_SETUP = btoa(
    'https://beta-bridge.simplefin.org/simplefin/claim/new',
  )

  it('replaces a revoked connection’s credential and keeps its links and history', async () => {
    const f = await fixture([card([[2, '-1.00']])])
    await f.link('ACT-1', 'Card')
    await f.sync()
    const synced = await f.row()
    f.reply.status = 403
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(f.sync()).rejects.toThrow(/no longer accepts/)
    log.mockRestore()
    const sealed = (await f.db.select().from(bankConnections).get())!
    f.reply.status = undefined
    await reconnectSimplefin(
      f.a,
      { id: f.id, setupToken: NEW_SETUP },
      KEY,
      f.transport,
    )
    const [connection] = await listConnections(f.a)
    expect(connection).toMatchObject({
      id: f.id,
      status: 'ready',
      lastError: null,
    })
    expect(connection.accounts[0]).toMatchObject({
      account: 'Card',
      present: true,
      syncedThrough: synced.syncedThrough,
      historyComplete: true,
    })
    const resealed = (await f.db.select().from(bankConnections).get())!
    expect(resealed.encryptedAccess).not.toBe(sealed.encryptedAccess)
    await f.sync()
    expect(await f.added()).toBe(1)
  })

  it('won’t spend a token on another Household’s connection, or without a key', async () => {
    const f = await fixture([card([])])
    const claims: Array<string> = []
    const counting = ((url: string, init?: RequestInit) => {
      if (url.includes('/claim/')) claims.push(url)
      return f.transport(url, init)
    }) as typeof fetch
    await expect(
      reconnectSimplefin(
        f.b,
        { id: f.id, setupToken: NEW_SETUP },
        KEY,
        counting,
      ),
    ).rejects.toThrow(/no longer exists/)
    await expect(
      reconnectSimplefin(
        f.a,
        { id: f.id, setupToken: NEW_SETUP },
        undefined,
        counting,
      ),
    ).rejects.toThrow(/BANK_CONNECTION_KEY/)
    expect(claims).toEqual([])
  })

  it('refuses access that another connection already has', async () => {
    const f = await fixture([card([])])
    const other = ((url: string, init?: RequestInit) =>
      url.includes('/claim/')
        ? Promise.resolve(
            new Response(
              'https://user:other@beta-bridge.simplefin.org/simplefin',
            ),
          )
        : f.transport(url, init)) as typeof fetch
    await connectSimplefin(
      f.b,
      me,
      { name: 'B', setupToken: NEW_SETUP },
      KEY,
      other,
    )
    await expect(
      reconnectSimplefin(f.a, { id: f.id, setupToken: NEW_SETUP }, KEY, other),
    ).rejects.toThrow(/already connected/)
  })
})
