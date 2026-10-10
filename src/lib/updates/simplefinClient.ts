/**
 * A read-only SimpleFIN Bridge client (https://www.simplefin.org/protocol.html).
 * Only Bridge's own hosts are ever called: no arbitrary URLs or redirects,
 * and errors never echo a response or the credential-bearing access URL.
 */
import { z } from 'zod'
import { readLimited } from './http'

const MESSAGES = {
  claim:
    'That setup token couldn’t be claimed; each one works only once. Make a fresh token in SimpleFIN Bridge.',
  auth: 'SimpleFIN no longer accepts this connection. Disconnect it and connect again with a new setup token.',
  payment: 'SimpleFIN needs an active subscription. Check your plan in Bridge.',
  network: 'SimpleFIN couldn’t be reached. Try again later.',
  invalid: 'SimpleFIN sent something Budgy couldn’t safely read.',
}

export class SimplefinError extends Error {
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
  } catch {
    throw new SimplefinError('network')
  }
  if (response.status >= 300 && response.status < 400)
    throw new SimplefinError('invalid')
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
 * Bridge's accounts, and any problems it reported (often an institution
 * needing a new login): what it returned is real but partial. The protocol
 * means these messages for the user, so they're kept, cleaned and short.
 */
export async function fetchSimplefin(
  access: string,
  options: { balancesOnly?: boolean; start?: number; end?: number },
  transport: typeof fetch = fetch,
): Promise<{ accounts: Array<SimplefinAccount>; problems: Array<string> }> {
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
  return {
    accounts: normalize(parsed.data),
    problems: problems([
      ...(parsed.data.errors ?? []),
      ...(parsed.data.errlist ?? []),
    ]),
  }
}

/** Bridge's messages as plain, short, distinct text (v1 strings, v2 `msg`). */
function problems(reported: Array<unknown>): Array<string> {
  const messages = reported.map((entry) => {
    const text =
      typeof entry === 'string'
        ? entry
        : typeof entry === 'object' &&
            entry !== null &&
            'msg' in entry &&
            typeof entry.msg === 'string'
          ? entry.msg
          : 'An institution needs attention.'
    const clean = text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean
  })
  return [...new Set(messages.filter(Boolean))].slice(0, 5)
}
