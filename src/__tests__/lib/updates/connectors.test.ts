import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDatabase } from '../../helpers/d1'
import type { DatabaseSync } from 'node:sqlite'
import type { CloudflareEnv } from '@/lib/db'
import type { SyncMessage } from '@/lib/updates/syncQueue'
import { householdDatabase } from '@/lib/households/scope'
import { LEGACY_HOUSEHOLD_ID } from '@/lib/households/membership'
import {
  balances,
  bankAccounts,
  bankConnections,
  householdMembers,
  households,
  moneyIn,
  transactions,
  uploadTokens,
  user,
} from '@/lib/db/schema'
import {
  deleteAccount,
  postTransactions,
  recordBalances,
  saveAccount,
} from '@/lib/ledger/accounts'
import { syncConnection } from '@/lib/updates/sync'
import { consumeSyncBatch, enqueueSyncs } from '@/lib/updates/syncQueue'
import { today as householdToday } from '@/lib/model/dates'
import {
  createUploadToken,
  listUploadTokens,
  revokeUploadToken,
} from '@/lib/updates/uploads'
import { serveUpload } from '@/lib/updates/uploadEndpoint'
import { UPLOAD_PATH } from '@/lib/updates/exports'
import { listAccountUpdates } from '@/lib/updates/queries'
import {
  MAX_CONNECTIONS,
  connectSimplefin,
  disconnectSimplefin,
  discoverAccounts,
  listConnections,
  mapBankAccount,
} from '@/lib/updates/connections'
import { decryptAccess, encryptAccess } from '@/lib/updates/crypto'
import {
  API_PROBLEM,
  SimplefinError,
  claimSimplefin,
  fetchSimplefin,
  issueKind,
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
  await db.insert(user).values([
    { id: 'm-a', name: 'A', email: 'a@example.com', emailVerified: true },
    { id: 'm-b', name: 'B', email: 'b@example.com', emailVerified: true },
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

  it('admits by its creator’s current email, not the one it was made with', async () => {
    // Only the original Household still gates Members by ALLOWED_EMAILS
    // (docs/adr/0008), so that's where a stale address would matter.
    const { db, env } = await fixture()
    const creator = { id: 'm-c', email: 'c@example.com' }
    await db.insert(user).values({ ...creator, name: 'C', emailVerified: true })
    await db.insert(householdMembers).values({
      householdId: LEGACY_HOUSEHOLD_ID,
      memberId: creator.id,
      role: 'owner',
    })
    const initial = householdDatabase(db, LEGACY_HOUSEHOLD_ID)
    await saveAccount(initial, { name: 'Card', ...card }, true)
    const { token } = await createUploadToken(
      initial,
      creator,
      'Card',
      'spending-positive',
    )
    const allowed = { ...env, ALLOWED_EMAILS: creator.email }
    expect((await upload(allowed, token, csv)).status).toBe(200)
    // c@example.com stays allowlisted, but it's no longer this Member's.
    await db
      .update(user)
      .set({ email: 'c@elsewhere.example' })
      .where(eq(user.id, creator.id))
    expect((await upload(allowed, token, csv)).status).toBe(401)
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

  it('stop at five per Account, even when requested all at once', async () => {
    const { a, b, db } = await fixture()
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        createUploadToken(a, me, 'Card', 'spending-positive'),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
    expect(
      results.find((r) => r.status === 'rejected')?.reason.message,
    ).toContain('already has 5 Shortcut tokens')
    const listed = await listUploadTokens(a)
    expect(listed).toHaveLength(5)
    expect(listed[0].createdAt).toBeInstanceOf(Date)
    // Revoking one makes room; another Household's Account is its own.
    await revokeUploadToken(a, listed[0].id)
    await createUploadToken(a, me, 'Card', 'spending-positive')
    await createUploadToken(b, me, 'Card', 'spending-positive')
    expect(await db.select().from(uploadTokens)).toHaveLength(7)
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
      'https://beta-bridge.simplefin.org/simplefin/accounts?balances-only=1&version=2',
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

  it('holds a Household to five connections, before spending a setup token', async () => {
    const { a, b } = await fixture()
    const claimed: Array<string> = []
    const transport = ((url: string) => {
      if (url.includes('/claim/')) {
        const name = url.split('/').at(-1)!
        claimed.push(name)
        return Promise.resolve(
          new Response(
            `https://user:${name}@beta-bridge.simplefin.org/simplefin`,
          ),
        )
      }
      return Promise.resolve(Response.json({ accounts: [] }))
    }) as typeof fetch
    const connect = (scope: typeof a, name: string) =>
      connectSimplefin(
        scope,
        me,
        {
          name,
          setupToken: btoa(
            `https://beta-bridge.simplefin.org/simplefin/claim/${name}`,
          ),
        },
        KEY,
        transport,
      )
    for (let i = 0; i < MAX_CONNECTIONS; i++) await connect(a, `a${i}`)
    await expect(connect(a, 'extra')).rejects.toThrow(/5 bank connections/)
    expect(claimed).not.toContain('extra')
    await connect(b, 'b0')
    expect(await listConnections(a)).toHaveLength(MAX_CONNECTIONS)
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

  it('records a revoked connection, keeping its credential, and limits daily requests', async () => {
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
    expect((await listConnections(a))[0]).toMatchObject({
      status: 'revoked',
      lastError: expect.stringContaining('Make a new setup token'),
    })
    expect(
      (await a.select().from(bankConnections).get())!.encryptedAccess,
    ).toBeTruthy()
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
        connId: 'CON-1',
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

  it('asks for a window and single accounts, in protocol 2', async () => {
    const urls: Array<string> = []
    const transport = ((url: string) => {
      urls.push(url)
      return Promise.resolve(Response.json({ accounts: [] }))
    }) as typeof fetch
    await fetchSimplefin(
      ACCESS,
      { start: 100, end: 200, accounts: ['ACT-1', 'ACT 2'] },
      transport,
    )
    const url = new URL(urls[0])
    expect(url.searchParams.get('start-date')).toBe('100')
    expect(url.searchParams.get('end-date')).toBe('200')
    expect(url.searchParams.getAll('account')).toEqual(['ACT-1', 'ACT 2'])
    expect(url.searchParams.get('version')).toBe('2')
  })

  it('reads errlist codes, falling back to their prefix, and keeps developer errors from Members', async () => {
    expect(issueKind('con.auth')).toBe('con.auth')
    expect(issueKind('con.mfa')).toBe('con')
    expect(issueKind('ACT.MISSINGDATA')).toBe('act.missingdata')
    expect(issueKind('act.new-thing')).toBe('act')
    expect(issueKind('gen.')).toBe('gen')
    expect(issueKind('weird')).toBe('unknown')
    expect(issueKind(7)).toBe('unknown')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const transport = (() =>
      Promise.resolve(
        Response.json({
          errlist: [
            { code: 'con.auth', msg: 'Sign in to Chase', conn_id: 'CON-1' },
            { code: 'act.failed', msg: 'Try later', account_id: 'ACT-1' },
            { code: 'gen.api', msg: 'bad param start-date=secret-123' },
          ],
          accounts: [],
        }),
      )) as typeof fetch
    const { issues, problems } = await fetchSimplefin(ACCESS, {}, transport)
    expect(issues).toEqual([
      { kind: 'con.auth', message: 'Sign in to Chase', connId: 'CON-1' },
      { kind: 'act.failed', message: 'Try later', accountId: 'ACT-1' },
      { kind: 'gen.api', message: API_PROBLEM },
    ])
    expect(problems.join()).not.toContain('secret-123')
    expect(JSON.stringify(log.mock.calls)).toContain('gen.api')
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-123')
    log.mockRestore()
  })

  it('treats gen.auth like a 403, and says plainly when the subscription lapsed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const genAuth = (() =>
      Promise.resolve(
        Response.json({ errlist: [{ code: 'gen.auth' }], accounts: [] }),
      )) as typeof fetch
    await expect(fetchSimplefin(ACCESS, {}, genAuth)).rejects.toMatchObject({
      kind: 'auth',
    })
    const lapsed = (() =>
      Promise.resolve(new Response('', { status: 402 }))) as typeof fetch
    await expect(fetchSimplefin(ACCESS, {}, lapsed)).rejects.toThrow(
      'Your SimpleFIN Bridge subscription needs renewing. Renew it at https://bridge.simplefin.org/',
    )
    log.mockRestore()
  })

  it('warns that a setup token claimed already may be compromised', async () => {
    const taken = (() =>
      Promise.resolve(new Response('', { status: 403 }))) as typeof fetch
    await expect(claimSimplefin(SETUP, taken)).rejects.toThrow(
      /someone else may have: disable it in SimpleFIN Bridge/,
    )
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

  it('opens a credential under the previous key during rotation, and reseals it', async () => {
    const { a, db } = await fixture()
    const { transport, calls } = bridge([sapphire])
    const { id } = await connectSimplefin(
      a,
      me,
      { name: 'Bridge', setupToken: SETUP },
      KEY,
      transport,
    )
    const sealedBefore = (await db.select().from(bankConnections).get())!
      .encryptedAccess
    const NEW = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
    // The new key alone can't open what the old one sealed.
    await expect(discoverAccounts(a, id, NEW, transport)).rejects.toThrow(
      'credentials couldn’t be opened',
    )
    await discoverAccounts(a, id, { current: NEW, previous: KEY }, transport)
    expect(calls.at(-1)?.authorization).toBe(`Basic ${btoa('user:secret')}`)
    const sealedAfter = (await db.select().from(bankConnections).get())!
      .encryptedAccess
    expect(sealedAfter).not.toBe(sealedBefore)
    expect(await decryptAccess(sealedAfter, NEW, `simplefin:a:${id}`)).toBe(
      ACCESS,
    )
    // Resealed: the previous key can now be retired.
    await discoverAccounts(a, id, { current: NEW }, transport)
    expect(
      (await db.select().from(bankConnections).get())!.encryptedAccess,
    ).toBe(sealedAfter)
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
    // Its first sync reads its history, for just this account.
    expect(urls.at(-1)).toMatch(
      /accounts\?start-date=\d+&end-date=\d+&account=ACT-1&version=2$/,
    )

    // The next sync overlaps; nothing is added twice, and a posted
    // pending purchase arrives under its own ID.
    sapphireCard.transactions[1] = txn('t2', '-50.00', 'Grocer')
    expect(await syncConnection(a, id, KEY, transport)).toEqual([
      { account: 'Card', added: 1, balance: true },
    ])
    expect(urls.at(-1)).toMatch(/accounts\?start-date=\d+&version=2$/)
    expect(await db.select().from(transactions)).toHaveLength(3)
    expect((await listAccountUpdates(b))[0].latest).toBeNull()
  })

  it('skips a purchase it can’t take and lists it, rather than failing the account every sync', async () => {
    const { db, a, id, transport } = await linked([
      {
        ...sapphire,
        transactions: [
          txn('t1', '-12.34', 'Coffee Shop'),
          txn('t2', '-2500000.00', 'Wire to escrow'),
        ],
      },
    ])
    expect(await syncConnection(a, id, KEY, transport)).toEqual([
      { account: 'Card', added: 1, balance: true },
    ])
    expect(
      (await db.select().from(transactions)).map((t) => t.description),
    ).toEqual(['Coffee Shop'])
    const [update] = await listAccountUpdates(a)
    expect(update.latest).toMatchObject({
      status: 'attention',
      added: 1,
      review: 1,
      issues: [
        {
          description: 'Wire to escrow',
          amount: 2_500_000,
          reason: expect.stringContaining('up to $1,000,000'),
        },
      ],
    })
    const [link] = await db.select().from(bankAccounts)
    expect(link.syncedThrough).toBeTruthy()
  })

  it('records purchases but not a balance it can’t hold', async () => {
    const { db, a, id, transport } = await linked([
      {
        ...sapphire,
        balance: '-250000000.00',
        transactions: [txn('t1', '-12.34', 'Coffee Shop')],
      },
    ])
    const [result] = await syncConnection(a, id, KEY, transport)
    expect(result).toMatchObject({ account: 'Card', added: 1 })
    expect(result.balance).toBeUndefined()
    expect(result.error).toMatch(/balance .* wasn’t recorded/)
    expect(await db.select().from(balances)).toEqual([])
    const [link] = await db.select().from(bankAccounts)
    expect(link.syncedThrough).toBeTruthy()
    // However a balance arrives (an Agent, say), it's held to the same bound.
    for (const amount of [1e13, Number.NaN, 1.5])
      await expect(
        recordBalances(
          a,
          [{ account: 'Card', date: '2026-10-01', amount }],
          'x',
        ),
      ).rejects.toThrow('up to $100,000,000')
  })

  it('reads back to the last sync with an overlap once its history is in', async () => {
    const { a, id, transport, urls } = await linked([sapphire])
    const startDay = (url: string) =>
      new Date(Number(new URL(url).searchParams.get('start-date')) * 1000)
        .toISOString()
        .slice(0, 10)
    urls.length = 0 // discovery, on connecting
    await syncConnection(a, id, KEY, transport)
    const today = new Date().toISOString().slice(0, 10)
    const days = (from: string) =>
      Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000)
    // Nothing in its first 90 days: the bank has no more history.
    expect(urls).toHaveLength(1)
    expect(days(startDay(urls[0]))).toBe(89)
    await syncConnection(a, id, KEY, transport)
    expect(urls).toHaveLength(2)
    expect(days(startDay(urls[1]))).toBeGreaterThanOrEqual(10)
    expect(days(startDay(urls[1]))).toBeLessThanOrEqual(12)
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

  it('records only a balance for an investment Account, and keeps bank deposits as Money in', async () => {
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
        { account: 'Checking', added: 1, moneyIn: 1, balance: true },
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
    expect(await f.db.select().from(moneyIn)).toMatchObject([
      {
        account: 'Checking',
        description: 'Payroll ACME',
        amount: 200_000,
        use: 'income',
      },
    ])
    // The overlap next time adds nothing twice.
    const again = await syncConnection(f.a, id, KEY, live.transport)
    expect(again.find((r) => r.account === 'Checking')?.moneyIn).toBe(0)
    expect(await f.db.select().from(moneyIn)).toHaveLength(1)
  })

  /** Household A and B each with a linked connection, Bridge per access. */
  async function twoHouseholds() {
    const f = await fixture()
    const failing = new Set<string>()
    const requests: Array<string> = []
    const transport = ((url: string, init?: RequestInit) => {
      if (url.includes('/claim/'))
        return Promise.resolve(
          new Response(
            `https://user:${url.split('/').at(-1)}@beta-bridge.simplefin.org/simplefin`,
          ),
        )
      const who = atob(
        new Headers(init?.headers).get('authorization')!.slice(6),
      ).split(':')[1]
      requests.push(who)
      if (failing.has(who))
        return Promise.resolve(new Response('down', { status: 503 }))
      return Promise.resolve(
        Response.json({
          accounts: [
            { ...sapphire, transactions: [txn('t1', '-1', `${who} shop`)] },
          ],
        }),
      )
    }) as typeof fetch
    const connect = async (
      scope: typeof f.a,
      name: string,
      link: boolean,
    ): Promise<string> => {
      const { id } = await connectSimplefin(
        scope,
        me,
        {
          name,
          setupToken: btoa(
            `https://beta-bridge.simplefin.org/simplefin/claim/${name}`,
          ),
        },
        KEY,
        transport,
      )
      if (link)
        await mapBankAccount(scope, {
          connectionId: id,
          providerId: 'ACT-1',
          account: 'Card',
        })
      return id
    }
    const idA = await connect(f.a, 'a', true)
    const idB = await connect(f.b, 'b', true)
    await connect(f.a, 'unlinked', false)
    requests.length = 0
    return { ...f, transport, failing, requests, idA, idB }
  }

  /** A queue batch whose messages record how they were settled. */
  function batchOf(bodies: Array<unknown>, attempts = 1) {
    const settled: Array<{ acked?: true; retry?: number }> = []
    const messages = bodies.map((body, i) => {
      settled.push({})
      return {
        id: `m${i}`,
        timestamp: new Date(),
        body,
        attempts,
        ack: () => (settled[i].acked = true),
        retry: (options?: { delaySeconds?: number }) =>
          (settled[i].retry = options?.delaySeconds ?? 0),
      }
    })
    return {
      batch: { messages, queue: 'budgy-sync' } as unknown as MessageBatch,
      settled,
    }
  }

  const shops = async (db: Awaited<ReturnType<typeof fixture>>['db']) =>
    (await db.select().from(transactions))
      .map((t) => `${t.householdId}:${t.description}`)
      .sort()

  it('queues one message per linked connection, across Households, without secrets', async () => {
    const f = await twoHouseholds()
    const sent: Array<unknown> = []
    const queue = {
      sendBatch: (messages: Iterable<{ body: unknown }>) => {
        for (const m of messages) sent.push(m.body)
        return Promise.resolve()
      },
    } as unknown as Queue<SyncMessage>
    expect(await enqueueSyncs(f.env.DB, queue)).toBe(2)
    expect(sent).toEqual(
      expect.arrayContaining([
        { householdId: 'a', connectionId: f.idA },
        { householdId: 'b', connectionId: f.idB },
      ]),
    )
    expect(sent).toHaveLength(2)
    expect(JSON.stringify(sent)).not.toMatch(/secret|simplefin\.org|v1\./)
    // Enqueueing calls no bank.
    expect(f.requests).toEqual([])
  })

  it('syncs only the message’s connection, in its own Household', async () => {
    const f = await twoHouseholds()
    const { batch, settled } = batchOf([
      { householdId: 'b', connectionId: f.idB },
    ])
    await consumeSyncBatch(f.env.DB, batch, KEY, f.transport)
    expect(settled).toEqual([{ acked: true }])
    // Its first sync: the newest window of history, then the one before.
    expect(f.requests).toEqual(['b', 'b'])
    expect(await shops(f.db)).toEqual(['b:b shop'])
  })

  it('drops a message naming another Household’s connection, or one that’s gone', async () => {
    const f = await twoHouseholds()
    await disconnectSimplefin(f.b, f.idB)
    const { batch, settled } = batchOf([
      { householdId: 'a', connectionId: f.idB },
      { householdId: 'b', connectionId: f.idB },
      { householdId: 'a', connectionId: f.idA, extra: 'x' },
      'nonsense',
    ])
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await consumeSyncBatch(f.env.DB, batch, KEY, f.transport)
    log.mockRestore()
    expect(settled).toEqual([
      { acked: true },
      { acked: true },
      { acked: true },
      { acked: true },
    ])
    expect(f.requests).toEqual([])
    expect(await shops(f.db)).toEqual([])
  })

  it('retries a connection Bridge can’t reach, a few times, without holding up the others', async () => {
    const f = await twoHouseholds()
    f.failing.add('a')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = batchOf([
      { householdId: 'a', connectionId: f.idA },
      { householdId: 'b', connectionId: f.idB },
    ])
    await consumeSyncBatch(f.env.DB, first.batch, KEY, f.transport)
    expect(first.settled).toEqual([{ retry: 600 }, { acked: true }])
    expect(await shops(f.db)).toEqual(['b:b shop'])

    const last = batchOf([{ householdId: 'a', connectionId: f.idA }], 3)
    await consumeSyncBatch(f.env.DB, last.batch, KEY, f.transport)
    expect(last.settled).toEqual([{ acked: true }])
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
    log.mockRestore()
  })

  it('doesn’t retry what another try can’t fix, such as today’s request limit', async () => {
    const f = await twoHouseholds()
    await f.db
      .update(bankConnections)
      .set({ requestDay: householdToday('America/New_York'), requestCount: 20 })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { batch, settled } = batchOf([
      { householdId: 'a', connectionId: f.idA },
    ])
    await consumeSyncBatch(f.env.DB, batch, KEY, f.transport)
    log.mockRestore()
    expect(settled).toEqual([{ acked: true }])
    expect(f.requests).toEqual([])
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
