import { afterEach, describe, expect, it } from 'vitest'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import type { CloudflareEnv } from '@/lib/db'
import { householdDatabase } from '@/lib/households/scope'
import {
  balances,
  householdMembers,
  households,
  transactions,
} from '@/lib/db/schema'
import {
  deleteAccount,
  postTransactions,
  saveAccount,
} from '@/lib/ledger/accounts'
import { syncAll, syncConnection } from '@/lib/updates/sync'
import {
  createUploadToken,
  listUploadTokens,
  revokeUploadToken,
} from '@/lib/updates/uploads'
import { serveUpload } from '@/lib/updates/uploadEndpoint'
import { UPLOAD_PATH } from '@/lib/updates/exports'
import { listAccountUpdates } from '@/lib/updates/queries'
import {
  connectSimplefin,
  disconnectSimplefin,
  discoverAccounts,
  listConnections,
  mapBankAccount,
} from '@/lib/updates/connections'
import { decryptAccess, encryptAccess } from '@/lib/updates/crypto'
import {
  SimplefinError,
  claimSimplefin,
  fetchSimplefin,
} from '@/lib/updates/simplefinClient'

const open: Array<DatabaseSync> = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const ACCESS = 'https://user:secret@beta-bridge.simplefin.org/simplefin'
const SETUP = btoa('https://beta-bridge.simplefin.org/simplefin/claim/demo')
const card = {
  owner: 'Joint',
  kind: 'credit' as const,
  institution: null,
  closed: false,
  securedBy: null,
}
const me = { id: 'm-a', email: 'a@example.com' }

async function fixture() {
  const { db, sqlite, newClient, d1 } = testDatabase()
  open.push(sqlite)
  await db.insert(households).values([
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ])
  await db.insert(householdMembers).values([
    { householdId: 'a', memberId: 'm-a', role: 'owner' },
    { householdId: 'b', memberId: 'm-b', role: 'owner' },
  ])
  const a = householdDatabase(newClient(), 'a')
  const b = householdDatabase(newClient(), 'b')
  for (const scope of [a, b])
    await saveAccount(scope, { name: 'Card', ...card }, true)
  const env = {
    DB: d1,
    ALLOWED_EMAILS: 'a@example.com,b@example.com',
  } as unknown as CloudflareEnv
  return { db, a, b, env }
}

const upload = (env: CloudflareEnv, token: string, body: string) =>
  serveUpload(
    new Request(`https://budgy.test${UPLOAD_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/csv' },
      body,
    }),
    env,
  )
const csv = 'Date,Description,Amount\n2026-10-01,Coffee Shop,5'

describe('Shortcut upload tokens', () => {
  it('adds a CSV to only its own Account and Household, recording a Shortcut receipt', async () => {
    const { db, a, b, env } = await fixture()
    const { token } = await createUploadToken(
      a,
      me,
      'card',
      'spending-positive',
    )
    expect(token).toMatch(/^bu_[A-Za-z0-9_-]{43}$/)

    const response = await upload(env, token, csv)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(
      'Card: 1 added, 0 already in Budgy, 0 not spending.',
    )
    const again = await upload(env, token, csv)
    expect(await again.text()).toContain('0 added, 1 already in Budgy')

    const rows = await db.select().from(transactions)
    expect(rows.map((r) => r.householdId)).toEqual(['a'])
    expect((await listAccountUpdates(a))[0].success?.source).toBe('shortcut')
    expect((await listAccountUpdates(b))[0].latest).toBeNull()
    expect((await listUploadTokens(a))[0].lastUsedAt).not.toBeNull()
    expect(await listUploadTokens(b)).toEqual([])
  })

  it('refuses revoked, Agent-shaped or unknown tokens, and other sites', async () => {
    const { a, env } = await fixture()
    const { id, token } = await createUploadToken(a, me, 'Card', 'apple-card')
    expect((await upload(env, `bg_${token.slice(3)}`, csv)).status).toBe(401)
    expect((await upload(env, 'bu_nope', csv)).status).toBe(401)
    const cross = await serveUpload(
      new Request(`https://budgy.test${UPLOAD_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          origin: 'https://evil.test',
        },
        body: csv,
      }),
      env,
    )
    expect(cross.status).toBe(403)
    await revokeUploadToken(a, id)
    expect((await upload(env, token, csv)).status).toBe(401)
  })

  it('stops working when its creator leaves or its Account closes, and is removed with the Account', async () => {
    const { db, a, env } = await fixture()
    const first = await createUploadToken(a, me, 'Card', 'spending-positive')
    await saveAccount(a, { name: 'Card', ...card, closed: true }, false)
    expect((await upload(env, first.token, csv)).status).toBe(401)
    await saveAccount(a, { name: 'Card', ...card }, false)
    expect((await upload(env, first.token, csv)).status).toBe(200)
    await db.delete(householdMembers)
    expect((await upload(env, first.token, csv)).status).toBe(401)

    await saveAccount(a, { name: 'Empty', ...card }, true)
    await createUploadToken(a, me, 'Empty', 'spending-positive')
    await deleteAccount(a, 'Empty')
    expect((await listUploadTokens(a)).map((t) => t.account)).toEqual(['Card'])
  })

  it('records a malformed upload as a failed check without echoing the file', async () => {
    const { a, env } = await fixture()
    const { token } = await createUploadToken(a, me, 'Card', 'apple-card')
    const response = await upload(env, token, 'not,a\nreal,export')
    expect(response.status).toBe(422)
    expect(await response.text()).toMatch(/^Card wasn’t updated\./)
    expect((await listAccountUpdates(a))[0].latest?.status).toBe('failed')
  })

  it('rejects incompatible Accounts and formats', async () => {
    const { a } = await fixture()
    await saveAccount(a, { name: 'House', ...card, kind: 'property' }, true)
    await expect(
      createUploadToken(a, me, 'House', 'spending-positive'),
    ).rejects.toThrow(/card and bank/)
    await saveAccount(a, { name: 'Checking', ...card, kind: 'checking' }, true)
    await expect(
      createUploadToken(a, me, 'Checking', 'apple-card'),
    ).rejects.toThrow(/credit card account/)
  })
})

/** A fake Bridge: the claim, then the accounts it lists. */
function bridge(accounts: Array<object>, errors: Array<string> = []) {
  const calls: Array<{ url: string; authorization: string | null }> = []
  const transport = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      authorization: new Headers(init?.headers).get('authorization'),
    })
    if (url.includes('/claim/')) return Promise.resolve(new Response(ACCESS))
    return Promise.resolve(Response.json({ errors, accounts }))
  }) as typeof fetch
  return { transport, calls }
}
const sapphire = {
  id: 'ACT-1',
  name: 'Sapphire',
  org: { domain: 'chase.com', name: 'Chase' },
  currency: 'USD',
  balance: '-120.50',
  'balance-date': 1791590000,
}

describe('SimpleFIN connections', () => {
  it('claims, stores access encrypted, and discovers accounts without importing purchases', async () => {
    const { db, a, b } = await fixture()
    const { transport, calls } = bridge([sapphire])
    const { id } = await connectSimplefin(
      a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      transport,
    )
    expect(calls.map((c) => c.url)).toEqual([
      'https://beta-bridge.simplefin.org/simplefin/claim/demo',
      'https://beta-bridge.simplefin.org/simplefin/accounts?balances-only=1',
    ])
    expect(calls[1].authorization).toBe(`Basic ${btoa('user:secret')}`)

    const [connection] = await listConnections(a)
    expect(connection).toMatchObject({ id, status: 'ready' })
    expect(JSON.stringify(connection)).not.toContain('secret')
    expect(connection.accounts).toMatchObject([
      { providerId: 'ACT-1', institution: 'Chase', account: null },
    ])
    expect(await listConnections(b)).toEqual([])
    expect(await db.select().from(transactions)).toEqual([])
  })

  it('won’t spend a one-time setup token without an encryption key, or connect the same access twice', async () => {
    const { a, b } = await fixture()
    const { transport, calls } = bridge([sapphire])
    await expect(
      connectSimplefin(
        a,
        me,
        { name: 'x', setupToken: SETUP },
        undefined,
        transport,
      ),
    ).rejects.toThrow(/BANK_CONNECTION_KEY/)
    expect(calls).toEqual([])
    await connectSimplefin(
      a,
      me,
      { name: 'x', setupToken: SETUP },
      KEY,
      transport,
    )
    await expect(
      connectSimplefin(b, me, { name: 'x', setupToken: SETUP }, KEY, transport),
    ).rejects.toThrow(/already connected/)
  })

  it('maps explicitly, one Budgy Account per bank account, within the Household', async () => {
    const { a, b } = await fixture()
    const second = { ...sapphire, id: 'ACT-2', name: 'Freedom' }
    const { transport } = bridge([sapphire, second])
    const { id } = await connectSimplefin(
      a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      transport,
    )
    const target = { connectionId: id, providerId: 'ACT-1', account: 'card' }
    await mapBankAccount(a, target)
    await mapBankAccount(a, target)
    await expect(
      mapBankAccount(a, { ...target, providerId: 'ACT-2' }),
    ).rejects.toThrow(/already linked to Sapphire/)
    await expect(mapBankAccount(b, target)).rejects.toThrow(/no longer exists/)
    expect(
      (await listConnections(a))[0].accounts.find(
        (x) => x.providerId === 'ACT-1',
      )?.account,
    ).toBe('Card')

    await mapBankAccount(a, { ...target, account: null })
    await mapBankAccount(a, { ...target, providerId: 'ACT-2' })
    expect(
      (await listConnections(a))[0].accounts.map((x) => x.account).sort(),
    ).toEqual(['Card', null])
  })

  it('keeps a mapping when Bridge stops listing an account, and flags institution problems', async () => {
    const { a } = await fixture()
    let accounts: Array<object> = [sapphire]
    let errors: Array<string> = []
    const transport = ((url: string) =>
      Promise.resolve(
        url.includes('/claim/')
          ? new Response(ACCESS)
          : Response.json({ errors, accounts }),
      )) as typeof fetch
    const { id } = await connectSimplefin(
      a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      transport,
    )
    await mapBankAccount(a, {
      connectionId: id,
      providerId: 'ACT-1',
      account: 'Card',
    })
    accounts = []
    errors = ['Connection to Vanguard may need attention.\n<b>Log in</b>']
    await discoverAccounts(a, id, KEY, transport)
    const [connection] = await listConnections(a)
    expect(connection.status).toBe('attention')
    expect(connection.lastError).toBe(
      'SimpleFIN says: Connection to Vanguard may need attention. b Log in /b Check your connections in SimpleFIN Bridge.',
    )
    expect(connection.accounts[0]).toMatchObject({
      account: 'Card',
      present: false,
    })
  })

  it('records a revoked connection as needing attention, and limits daily requests', async () => {
    const { a } = await fixture()
    let status = 200
    const transport = ((url: string) =>
      Promise.resolve(
        url.includes('/claim/')
          ? new Response(ACCESS)
          : Response.json({ accounts: [] }, { status }),
      )) as typeof fetch
    const { id } = await connectSimplefin(
      a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      transport,
    )
    status = 403
    await expect(discoverAccounts(a, id, KEY, transport)).rejects.toThrow(
      /no longer accepts/,
    )
    expect((await listConnections(a))[0].status).toBe('attention')
    status = 200
    for (let i = 2; i < 20; i++) await discoverAccounts(a, id, KEY, transport)
    await expect(discoverAccounts(a, id, KEY, transport)).rejects.toThrow(
      /request limit/,
    )
  })

  it('forgets the connection and its accounts on disconnect, only within the Household', async () => {
    const { a, b } = await fixture()
    const { transport } = bridge([sapphire])
    const { id } = await connectSimplefin(
      a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      transport,
    )
    await disconnectSimplefin(b, id)
    expect(await listConnections(a)).toHaveLength(1)
    await disconnectSimplefin(a, id)
    expect(await listConnections(a)).toEqual([])
  })
})

describe('SimpleFIN client', () => {
  it('calls only Bridge, over HTTPS, without credentials in claim URLs', async () => {
    const never = (() => {
      throw new Error('called')
    }) as typeof fetch
    for (const url of [
      'http://beta-bridge.simplefin.org/simplefin/claim/x',
      'https://evil.test/simplefin/claim/x',
      'https://bridge.simplefin.org.evil.test/simplefin/claim/x',
      'https://u:p@bridge.simplefin.org/simplefin/claim/x',
    ])
      await expect(claimSimplefin(btoa(url), never)).rejects.toThrow(
        SimplefinError,
      )
    await expect(
      fetchSimplefin('https://u:p@evil.test/simplefin', {}, never),
    ).rejects.toThrow(SimplefinError)
  })

  it('uses only fetch options Cloudflare Workers accept, and refuses redirects', async () => {
    // workerd throws on redirect: 'error' before sending anything.
    const workers = ((_url: string, init?: RequestInit) =>
      init?.redirect === 'manual'
        ? Promise.resolve(new Response(ACCESS))
        : Promise.reject(
            new TypeError('Invalid redirect value'),
          )) as typeof fetch
    expect(await claimSimplefin(SETUP, workers)).toBe(ACCESS)
    const redirecting = (() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.test' },
        }),
      )) as typeof fetch
    await expect(fetchSimplefin(ACCESS, {}, redirecting)).rejects.toThrow(
      /couldn’t read/,
    )
  })

  it('reads protocol 2 responses and tolerates null or missing optional fields', async () => {
    const transport = (() =>
      Promise.resolve(
        Response.json({
          errlist: [],
          connections: [{ conn_id: 'CON-1', name: 'Chase', org_id: 'x' }],
          accounts: [
            {
              id: 'ACT-1',
              name: 'Sapphire',
              conn_id: 'CON-1',
              currency: 'USD',
              balance: -120.5,
              'balance-date': 1791590000.5,
              'available-balance': null,
              transactions: [
                {
                  id: 't1',
                  posted: 1791500000,
                  amount: '-12.30',
                  description: null,
                  payee: 'Coffee Shop',
                  transacted_at: null,
                  pending: null,
                  extra: { category: 'Food' },
                },
              ],
              holdings: [],
            },
          ],
        }),
      )) as typeof fetch
    const { accounts, problems } = await fetchSimplefin(ACCESS, {}, transport)
    expect(problems).toEqual([])
    const blank = (() =>
      Promise.resolve(
        Response.json({ accounts: [{ ...sapphire, currency: '' }] }),
      )) as typeof fetch
    expect((await fetchSimplefin(ACCESS, {}, blank)).accounts[0].currency).toBe(
      'USD',
    )
    expect(accounts).toEqual([
      {
        id: 'ACT-1',
        name: 'Sapphire',
        institution: 'Chase',
        currency: 'USD',
        balance: '-120.5',
        balanceDate: 1791590000,
        transactions: [
          {
            id: 't1',
            posted: 1791500000,
            transactedAt: null,
            amount: '-12.30',
            description: 'Coffee Shop',
            pending: false,
          },
        ],
      },
    ])
  })

  it('logs where a response failed to match, never its values', async () => {
    const errors: Array<string> = []
    const original = console.error
    console.error = (...args: Array<unknown>) => errors.push(args.join(' '))
    try {
      const transport = (() =>
        Promise.resolve(
          Response.json({
            accounts: [{ id: 'ACT-1', balance: 'secret-balance-9999' }],
          }),
        )) as typeof fetch
      await expect(fetchSimplefin(ACCESS, {}, transport)).rejects.toThrow(
        SimplefinError,
      )
    } finally {
      console.error = original
    }
    expect(errors.join()).toContain('accounts.0.balance')
    expect(errors.join()).not.toContain('secret-balance-9999')
  })

  it('rejects an access URL from a claim that points elsewhere', async () => {
    const transport = (() =>
      Promise.resolve(
        new Response('https://u:p@evil.test/simplefin'),
      )) as typeof fetch
    await expect(claimSimplefin(SETUP, transport)).rejects.toThrow(
      /setup token didn’t work/,
    )
  })

  it('binds ciphertext to its Household and connection', async () => {
    const sealed = await encryptAccess(ACCESS, KEY, 'simplefin:a:1')
    expect(sealed).not.toContain('secret')
    expect(await decryptAccess(sealed, KEY, 'simplefin:a:1')).toBe(ACCESS)
    await expect(decryptAccess(sealed, KEY, 'simplefin:b:1')).rejects.toThrow()
  })
})

describe('SimpleFIN sync', () => {
  const now = Math.floor(Date.now() / 1000)
  const daysAgo = (n: number) => now - n * 86_400
  const txn = (
    id: string,
    amount: string,
    description: string,
    extra = {},
  ) => ({
    id,
    posted: daysAgo(2),
    amount,
    description,
    ...extra,
  })
  /** Bridge with mutable accounts, recording each accounts request. */
  function liveBridge(accounts: Array<Record<string, unknown>>) {
    const urls: Array<string> = []
    const transport = ((url: string) => {
      if (url.includes('/claim/')) return Promise.resolve(new Response(ACCESS))
      urls.push(url)
      return Promise.resolve(Response.json({ errors: [], accounts }))
    }) as typeof fetch
    return { transport, urls }
  }
  async function linked(accounts: Array<Record<string, unknown>>) {
    const f = await fixture()
    const live = liveBridge(accounts)
    const { id } = await connectSimplefin(
      f.a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      live.transport,
    )
    await mapBankAccount(f.a, {
      connectionId: id,
      providerId: 'ACT-1',
      account: 'Card',
    })
    return { ...f, ...live, id }
  }

  it('imports posted purchases once, skips pending and payments, and records what the card owes', async () => {
    const sapphireCard = {
      ...sapphire,
      transactions: [
        txn('t1', '-12.34', 'Coffee Shop'),
        txn('t2', '-50.00', 'Grocer', { pending: true }),
        txn('t3', '200.00', 'Payment Thank You'),
        txn('t4', '5.00', 'Coffee Shop refund'),
      ],
    }
    const { db, a, b, id, transport, urls } = await linked([sapphireCard])
    const results = await syncConnection(a, id, KEY, transport)
    expect(results).toEqual([{ account: 'Card', added: 2, balance: true }])
    const rows = await db.select().from(transactions)
    expect(rows.map((r) => [r.description, r.amount]).sort()).toEqual([
      ['Coffee Shop refund', -500],
      ['Coffee Shop', 1234],
    ])
    expect(rows.every((r) => r.sourceKey)).toBe(true)
    const [update] = await listAccountUpdates(a)
    expect(update.success).toMatchObject({ source: 'simplefin', added: 2 })
    expect(await db.select().from(balances)).toMatchObject([
      { householdId: 'a', account: 'Card', amount: 12_050 },
    ])
    expect(urls.at(-1)).toMatch(/accounts\?start-date=\d+$/)

    // The next sync overlaps; nothing is added twice, and a posted
    // pending purchase arrives under its own ID.
    sapphireCard.transactions[1] = txn('t2', '-50.00', 'Grocer')
    expect(await syncConnection(a, id, KEY, transport)).toEqual([
      { account: 'Card', added: 1, balance: true },
    ])
    expect(await db.select().from(transactions)).toHaveLength(3)
    expect((await listAccountUpdates(b))[0].latest).toBeNull()
  })

  it('reads back to the last sync with an overlap, and 45 days the first time', async () => {
    const { a, id, transport, urls } = await linked([sapphire])
    const startDay = (url: string) =>
      new Date(Number(new URL(url).searchParams.get('start-date')) * 1000)
        .toISOString()
        .slice(0, 10)
    await syncConnection(a, id, KEY, transport)
    const today = new Date().toISOString().slice(0, 10)
    const days = (from: string) =>
      Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000)
    expect(days(startDay(urls.at(-1)!))).toBeGreaterThanOrEqual(45)
    expect(days(startDay(urls.at(-1)!))).toBeLessThanOrEqual(47)
    await syncConnection(a, id, KEY, transport)
    expect(days(startDay(urls.at(-1)!))).toBeGreaterThanOrEqual(10)
    expect(days(startDay(urls.at(-1)!))).toBeLessThanOrEqual(12)
  })

  it('links a purchase already uploaded by export instead of adding it again', async () => {
    const sapphireCard = {
      ...sapphire,
      transactions: [txn('t1', '-12.34', 'Coffee Shop')],
    }
    const { db, a, id, transport } = await linked([sapphireCard])
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
    }).format(new Date(daysAgo(2) * 1000))
    await postTransactions(a, {
      account: 'Card',
      rows: [{ date, description: 'Coffee Shop', amount: 12.34 }],
      commit: true,
      importedBy: 'Member',
      via: 'shortcut',
    })
    const [result] = await syncConnection(a, id, KEY, transport)
    expect(result.added).toBe(0)
    expect(await db.select().from(transactions)).toHaveLength(1)
  })

  it('records only a balance for an investment Account, and leaves bank deposits out', async () => {
    const f = await fixture()
    await saveAccount(
      f.a,
      { name: 'Vanguard', ...card, kind: 'brokerage' },
      true,
    )
    await saveAccount(
      f.a,
      { name: 'Checking', ...card, kind: 'checking' },
      true,
    )
    const live = liveBridge([
      {
        ...sapphire,
        id: 'VG',
        name: 'Brokerage',
        balance: '1000.00',
        transactions: [txn('v1', '-100', 'Buy VTSAX')],
      },
      {
        ...sapphire,
        id: 'CHK',
        name: 'Checking',
        balance: '500.25',
        transactions: [
          txn('c1', '2000', 'Payroll ACME'),
          txn('c2', '-40', 'Hardware Store'),
        ],
      },
    ])
    const { id } = await connectSimplefin(
      f.a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      live.transport,
    )
    await mapBankAccount(f.a, {
      connectionId: id,
      providerId: 'VG',
      account: 'Vanguard',
    })
    await mapBankAccount(f.a, {
      connectionId: id,
      providerId: 'CHK',
      account: 'Checking',
    })
    const results = await syncConnection(f.a, id, KEY, live.transport)
    expect(results).toEqual(
      expect.arrayContaining([
        { account: 'Vanguard', balance: true },
        { account: 'Checking', added: 1, balance: true },
      ]),
    )
    const saved = await f.db.select().from(balances)
    expect(saved.map((x) => [x.account, x.amount]).sort()).toEqual([
      ['Checking', 50_025],
      ['Vanguard', 100_000],
    ])
    expect(
      (await f.db.select().from(transactions)).map((t) => t.description),
    ).toEqual(['Hardware Store'])
  })

  it('syncs every Household’s linked connections on schedule, each in its own scope', async () => {
    const f = await fixture()
    const bridgeA = liveBridge([
      { ...sapphire, transactions: [txn('t1', '-1', 'A shop')] },
    ])
    const { id: idA } = await connectSimplefin(
      f.a,
      me,
      { name: 'A', setupToken: SETUP },
      KEY,
      bridgeA.transport,
    )
    await mapBankAccount(f.a, {
      connectionId: idA,
      providerId: 'ACT-1',
      account: 'Card',
    })
    const otherAccess = 'https://user:other@beta-bridge.simplefin.org/simplefin'
    const transport = ((url: string) =>
      Promise.resolve(
        url.includes('/claim/')
          ? new Response(otherAccess)
          : Response.json({
              accounts: [
                { ...sapphire, transactions: [txn('t1', '-2', 'B shop')] },
              ],
            }),
      )) as typeof fetch
    const { id: idB } = await connectSimplefin(
      f.b,
      me,
      { name: 'B', setupToken: SETUP },
      KEY,
      transport,
    )
    await mapBankAccount(f.b, {
      connectionId: idB,
      providerId: 'ACT-1',
      account: 'Card',
    })

    await syncAll(f.env.DB, KEY, transport)
    const rows = await f.db.select().from(transactions)
    expect(rows.map((r) => r.householdId).sort()).toEqual(['a', 'b'])
  })

  it('needs a linked account before syncing', async () => {
    const { a } = await fixture()
    const { transport } = liveBridge([sapphire])
    const { id } = await connectSimplefin(
      a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      transport,
    )
    await expect(syncConnection(a, id, KEY, transport)).rejects.toThrow(
      /Link a bank account/,
    )
  })
})
