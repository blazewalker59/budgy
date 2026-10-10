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
  try {
    return await transport(url.toString(), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new SimplefinError('network')
  }
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

const timestamp = z.number().int().min(0).max(4_102_444_800)
const numeric = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .max(40)
const text = z.string().min(1).max(200)
const transaction = z.object({
  id: text,
  posted: timestamp,
  amount: numeric,
  description: z.string().max(400),
  pending: z.boolean().optional(),
  transacted_at: timestamp.optional(),
})
const providerAccount = z.object({
  id: text,
  name: text,
  org: z
    .object({
      domain: z.string().max(200).optional(),
      name: z.string().max(200).optional(),
    })
    .refine((org) => org.domain || org.name),
  currency: text,
  balance: numeric,
  'balance-date': timestamp,
  transactions: z.array(transaction).max(20_000).optional(),
})
const accountSet = z.object({
  errors: z.array(z.string().max(1000)).max(100).default([]),
  accounts: z.array(providerAccount).max(100),
})
export type SimplefinAccount = z.infer<typeof providerAccount>

/**
 * Bridge's accounts. `attention` means it also reported a problem (often an
 * institution needing a new login): what it returned is real but partial.
 */
export async function fetchSimplefin(
  access: string,
  options: { balancesOnly?: boolean; start?: number; end?: number },
  transport: typeof fetch = fetch,
): Promise<{ accounts: Array<SimplefinAccount>; attention: boolean }> {
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
  try {
    const parsed = accountSet.parse(
      JSON.parse(await readLimited(response.body, 5 * 1024 * 1024)),
    )
    return { accounts: parsed.accounts, attention: parsed.errors.length > 0 }
  } catch {
    throw new SimplefinError('invalid')
  }
}
