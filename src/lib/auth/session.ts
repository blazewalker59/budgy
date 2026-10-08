/**
 * The signed-in Member, for server functions. Server-only: kept apart from
 * the server-function modules so the client bundle never pulls in auth or
 * the database.
 *
 * Every Member shares the one Ledger, so there is no per-user scoping; the
 * gate is the allowlist, checked on every call, so removing an email locks
 * that person out at once (docs/adr/0001).
 */

import { isAllowed } from './allowlist'
import { getAuth } from './server'
import type { Database } from '@/lib/db'
import { getCloudflareEnv, getDb, serverRequestContext } from '@/lib/db'

export interface Member {
  id: string
  name: string
  email: string
  image: string | null
}

export type SessionState =
  | { status: 'member'; member: Member }
  | { status: 'not-allowed'; email: string }
  | { status: 'signed-out' }

export async function sessionState(): Promise<SessionState> {
  const env = getCloudflareEnv()
  // Local development can act as a Member without Google (never in a build).
  if (import.meta.env.DEV && env.DEV_MEMBER_EMAIL) {
    const email = env.DEV_MEMBER_EMAIL
    return {
      status: 'member',
      member: { id: 'dev', name: email.split('@')[0], email, image: null },
    }
  }
  const headers = serverRequestContext.getStore()?.headers
  if (!headers) return { status: 'signed-out' }
  const session = await getAuth(env).api.getSession({ headers })
  if (!session?.user) return { status: 'signed-out' }
  if (!isAllowed(session.user.email, env.ALLOWED_EMAILS))
    return { status: 'not-allowed', email: session.user.email }
  return {
    status: 'member',
    member: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
  }
}

export async function requireMember(): Promise<Member> {
  const state = await sessionState()
  if (state.status !== 'member') throw new Error('Sign in required')
  return state.member
}

/** Run with the Ledger's database, for a signed-in Member only. */
export async function withMember<T>(
  fn: (scope: { db: Database; member: Member }) => Promise<T>,
): Promise<T> {
  const member = await requireMember()
  return fn({ db: getDb(), member })
}
