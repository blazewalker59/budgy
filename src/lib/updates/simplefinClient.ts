/**
 * A read-only SimpleFIN Bridge client (https://www.simplefin.org/protocol.html).
 * Only Bridge's own hosts are ever called: no arbitrary URLs or redirects,
 * and errors never echo a response or the credential-bearing access URL.
 */
import { z } from 'zod'
import { readLimited } from './http'
import { UserError } from '@/lib/errors'

/** Where a Member renews a lapsed SimpleFIN Bridge subscription. */
export const SIMPLEFIN_BRIDGE = 'https://bridge.simplefin.org/'

const MESSAGES = {
  claim: 'That setup token didn’t work. Make a new one in SimpleFIN Bridge.',
  // The protocol: a 403 on claim means the token may have been claimed by
  // someone else, so the Member should disable it.
  claimed:
    'That setup token was already used. If you didn’t use it, someone else may have: disable it in SimpleFIN Bridge, then make a new one.',
  auth: 'SimpleFIN no longer accepts this connection: its access was revoked or its credentials changed. Make a new setup token in SimpleFIN Bridge and reconnect.',
  payment: `Your SimpleFIN Bridge subscription needs renewing. Renew it at ${SIMPLEFIN_BRIDGE}, then Budgy syncs again on its own.`,
  network: 'SimpleFIN couldn’t be reached. Try again later.',
  invalid: 'SimpleFIN sent data Budgy couldn’t read. Try again later.',
}

/** Its messages are written for Members; `kind` tells a retry what failed. */
export class SimplefinError extends UserError {
  constructor(public kind: keyof typeof MESSAGES) {
    super(MESSAGES[kind])
  }
}

function trustedUrl(value: string, claim: boolean): URL {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const bridge =
      host === 'bridge.simplefin.org' ||
      host === 'beta-bridge.simplefin.org' ||
      host.endsWith('.bridge.simplefin.org')
    const path = claim
      ? /^\/simplefin\/claim\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
        !url.username &&
        !url.password
      : (url.pathname === '/simplefin' ||
          url.pathname.startsWith('/simplefin/')) &&
        !!url.username &&
        !!url.password
    if (
      url.protocol !== 'https:' ||
      (url.port && url.port !== '443') ||
      !bridge ||
      !path ||
      url.search ||
      url.hash
    )
      throw new Error('Untrusted URL')
    return url
  } catch {
    throw new SimplefinError('invalid')
  }
}

async function call(url: URL, init: RequestInit, transport: typeof fetch) {
  let response: Response
  try {
    // Workers don't support redirect: 'error'; a redirect is refused here.
    response = await transport(url.toString(), {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    // The kind only (e.g. TimeoutError): never the URL, which may hold access.
    console.error(
      'SimpleFIN request failed:',
      error instanceof Error ? error.name : 'unknown',
    )
    throw new SimplefinError('network')
  }
  if (response.status >= 300 && response.status < 400) {
    console.error(`SimpleFIN redirected (HTTP ${response.status})`)
    throw new SimplefinError('invalid')
  }
  return response
}

/** Trade a one-time setup token for the access URL (the credential). */
export async function claimSimplefin(
  setupToken: string,
  transport: typeof fetch = fetch,
): Promise<string> {
  let url: URL
  try {
    url = trustedUrl(atob(setupToken.trim()), true)
  } catch {
    throw new SimplefinError('claim')
  }
  const response = await call(url, { method: 'POST' }, transport)
  if (response.status === 403) throw new SimplefinError('claimed')
  if (!response.ok) throw new SimplefinError('claim')
  try {
    const access = (await readLimited(response.body, 4096)).trim()
    trustedUrl(access, false)
    return access
  } catch {
    throw new SimplefinError('claim')
  }
}

/** Optional fields may be missing or null; both mean absent. */
const maybe = <T extends z.ZodType>(type: T) =>
  type.nullish().transform((value) => value ?? undefined)
const timestamp = z.number().min(0).max(4_102_444_800).transform(Math.floor)
const numeric = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(
    z
      .string()
      .regex(/^[+-]?\d+(\.\d+)?$/)
      .max(40),
  )
const label = maybe(z.string().max(1000))
const transaction = z.object({
  id: z.string().min(1).max(200),
  posted: maybe(timestamp),
  amount: numeric,
  description: label,
  payee: label,
  memo: label,
  pending: maybe(z.boolean()),
  transacted_at: maybe(timestamp),
})
const providerAccount = z.object({
  id: z.string().min(1).max(200),
  name: label,
  /** Protocol 1: the institution, on each account. */
  org: maybe(z.object({ domain: label, name: label })),
  /** Protocol 2: a key into the response's `connections`. */
  conn_id: label,
  currency: maybe(z.string().max(2048)),
  balance: numeric,
  'balance-date': maybe(timestamp),
  transactions: maybe(z.array(transaction).max(20_000)),
})
const accountSet = z.object({
  errors: maybe(z.array(z.unknown()).max(1000)),
  errlist: maybe(z.array(z.unknown()).max(1000)),
  connections: maybe(
    z
      .array(
        z.object({
          conn_id: label,
          name: label,
          org_name: label,
          org_url: label,
        }),
      )
      .max(1000),
  ),
  accounts: z.array(providerAccount).max(500),
})

/** One account as Budgy uses it, whichever protocol version Bridge spoke. */
export interface SimplefinAccount {
  id: string
  /** Protocol 2: the Bridge connection (institution login) it comes from. */
  connId: string | null
  name: string
  institution: string
  currency: string
  /** Decimal string, as Bridge sent it: negative for what's owed. */
  balance: string
  /** Unix seconds; null when Bridge didn't say. */
  balanceDate: number | null
  transactions: Array<SimplefinTransaction>
}
export interface SimplefinTransaction {
  id: string
  /** Unix seconds; 0 or null while pending. */
  posted: number | null
  transactedAt: number | null
  /** Decimal string: negative for money out. */
  amount: string
  description: string
  pending: boolean
}

function normalize(set: z.infer<typeof accountSet>): Array<SimplefinAccount> {
  const connections = new Map(
    (set.connections ?? []).map((c) => [c.conn_id, c]),
  )
  return set.accounts.map((a) => {
    const connection = a.conn_id ? connections.get(a.conn_id) : undefined
    return {
      id: a.id,
      connId: a.conn_id ?? null,
      name: a.name?.trim() || 'Unnamed account',
      institution:
        a.org?.name ??
        a.org?.domain ??
        connection?.org_name ??
        connection?.name ??
        'Unknown institution',
      // Some institutions send a blank currency; SimpleFIN's default is USD.
      currency: a.currency?.trim() || 'USD',
      balance: a.balance,
      balanceDate: a['balance-date'] ?? null,
      transactions: (a.transactions ?? []).map((t) => ({
        id: t.id,
        posted: t.posted ?? null,
        transactedAt: t.transacted_at ?? null,
        amount: t.amount,
        description: (t.description || t.payee || t.memo || '').trim(),
        pending: t.pending ?? false,
      })),
    }
  })
}

/**
 * What a protocol 2 `errlist` entry is about. Unknown subcodes count as
 * their prefix (`con.mfa` is a `con`); a v1 string is `unknown`.
 */
export type IssueKind =
  | 'gen'
  | 'gen.api'
  | 'gen.auth'
  | 'con'
  | 'con.auth'
  | 'act'
  | 'act.failed'
  | 'act.missingdata'
  | 'unknown'

/** One problem Bridge reported, with its message cleaned for Members. */
export interface SimplefinIssue {
  kind: IssueKind
  message: string
  connId?: string
  accountId?: string
}

const KNOWN: ReadonlyArray<IssueKind> = [
  'gen.api',
  'gen.auth',
  'con.auth',
  'act.failed',
  'act.missingdata',
]

/** A code as Budgy acts on it (the protocol's fallback to the prefix). */
export function issueKind(code: unknown): IssueKind {
  if (typeof code !== 'string') return 'unknown'
  const lower = code.trim().toLowerCase()
  if ((KNOWN as ReadonlyArray<string>).includes(lower))
    return lower as IssueKind
  const prefix = lower.split('.')[0]
  return prefix === 'gen' || prefix === 'con' || prefix === 'act'
    ? prefix
    : 'unknown'
}

/** Bridge ids are opaque; anything odd isn't one Budgy will match. */
const reference = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 200
    ? value
    : undefined

export interface SimplefinOptions {
  balancesOnly?: boolean
  /** Unix seconds. Bridge allows at most 90 days from start to end. */
  start?: number
  /** Unix seconds, exclusive; now when absent. */
  end?: number
  /** Only these accounts (Bridge's separate per-account quota). */
  accounts?: ReadonlyArray<string>
}

/**
 * Bridge's accounts, and any problems it reported (often an institution
 * needing a new login): what it returned is real but partial. The protocol
 * means these messages for the user, so they're kept, cleaned and short.
 * A `gen.auth` problem is the same as a 403: the access no longer works.
 */
export async function fetchSimplefin(
  access: string,
  options: SimplefinOptions,
  transport: typeof fetch = fetch,
): Promise<{
  accounts: Array<SimplefinAccount>
  problems: Array<string>
  issues: Array<SimplefinIssue>
}> {
  const url = trustedUrl(access, false)
  let credentials: string
  try {
    credentials = btoa(
      `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
    )
  } catch {
    throw new SimplefinError('invalid')
  }
  url.username = ''
  url.password = ''
  url.pathname = `${url.pathname.replace(/\/$/, '')}/accounts`
  if (options.balancesOnly) url.searchParams.set('balances-only', '1')
  if (options.start !== undefined)
    url.searchParams.set('start-date', String(options.start))
  if (options.end !== undefined)
    url.searchParams.set('end-date', String(options.end))
  for (const account of options.accounts ?? [])
    url.searchParams.append('account', account)
  url.searchParams.set('version', '2')
  const response = await call(
    url,
    {
      method: 'GET',
      headers: {
        authorization: `Basic ${credentials}`,
        accept: 'application/json',
      },
    },
    transport,
  )
  if (!response.ok)
    console.error(`SimpleFIN accounts request returned HTTP ${response.status}`)
  if (response.status === 401 || response.status === 403)
    throw new SimplefinError('auth')
  if (response.status === 402) throw new SimplefinError('payment')
  if (!response.ok) throw new SimplefinError('network')
  let body: unknown
  try {
    body = JSON.parse(await readLimited(response.body, 5 * 1024 * 1024))
  } catch {
    console.error('SimpleFIN response was not JSON within the size limit')
    throw new SimplefinError('invalid')
  }
  const parsed = accountSet.safeParse(body)
  if (!parsed.success) {
    // Paths and types only: never values, which are financial data.
    console.error(
      'SimpleFIN response did not match:',
      parsed.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join('.')}: ${i.code} (${i.message})`)
        .join('; '),
    )
    throw new SimplefinError('invalid')
  }
  const found = issues([
    ...(parsed.data.errors ?? []),
    ...(parsed.data.errlist ?? []),
  ])
  if (found.some((i) => i.kind === 'gen.api'))
    // A request Bridge says Budgy got wrong: the code only, never the text.
    console.error('SimpleFIN reported gen.api')
  if (found.some((i) => i.kind === 'gen.auth')) {
    console.error('SimpleFIN reported gen.auth')
    throw new SimplefinError('auth')
  }
  return {
    accounts: normalize(parsed.data),
    problems: [...new Set(found.map((i) => i.message))].slice(0, 5),
    issues: found,
  }
}

/** For a developer error (gen.api): Bridge's text isn't meant for Members. */
export const API_PROBLEM =
  'SimpleFIN couldn’t answer Budgy’s request this time. Budgy will try again.'

/** Bridge's messages as plain, short text (v1 strings, v2 `msg`). */
function issues(reported: Array<unknown>): Array<SimplefinIssue> {
  return reported.slice(0, 100).map((entry) => {
    const record =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)
        : {}
    const kind = typeof entry === 'string' ? 'unknown' : issueKind(record.code)
    const text =
      typeof entry === 'string'
        ? entry
        : typeof record.msg === 'string'
          ? record.msg
          : ''
    const clean = text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const message =
      kind === 'gen.api'
        ? API_PROBLEM
        : !clean
          ? 'An institution needs attention.'
          : clean.length > 200
            ? `${clean.slice(0, 199)}…`
            : clean
    return {
      kind,
      message,
      ...(reference(record.conn_id) && { connId: reference(record.conn_id) }),
      ...(reference(record.account_id) && {
        accountId: reference(record.account_id),
      }),
    }
  })
}
