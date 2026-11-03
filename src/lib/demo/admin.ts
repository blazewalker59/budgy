/**
 * The demo sandbox's actions, each behind `requireAdmin` (docs/adr/0015).
 * Server-only. The server functions (./server.ts) are thin wrappers over
 * `runAdmin`, so a test can try every action as a non-admin.
 */
import { z } from 'zod'
import {
  createPersona,
  deletePersona,
  listPersonas,
  replayInvite,
  resetPersona,
  startDemo,
  stopDemo,
} from './service'
import { LABEL_PATTERN, MAX_LABEL } from './personas'
import type { Database } from '@/lib/db'
import type { HouseholdDatabase } from '@/lib/households/scope'
import type { Member } from '@/lib/auth/session'
import { signedIn } from '@/lib/auth/session'
import { isAdmin } from '@/lib/auth/admins'
import { getCloudflareEnv, getDb } from '@/lib/db'
import { householdDatabase } from '@/lib/households/scope'
import { UserError } from '@/lib/errors'

export interface AdminContext {
  db: Database
  /** The admin themselves: never the persona they may be acting as. */
  admin: Member
  sessionId: string
  /** A Household-bound client, for reusing the Members' own code paths. */
  scope: (householdId: string) => HouseholdDatabase
}

/** Non-admins learn nothing: the same answer as a page that isn't there. */
export const NOT_FOUND = 'Page not found'

/**
 * The signed-in, admitted person, if `ADMIN_EMAILS` lists them, checked on
 * every request. Acting as a persona doesn't change who this is.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const env = getCloudflareEnv()
  const db = getDb()
  const who = await signedIn(env, db)
  if (
    !('member' in who) ||
    !who.sessionId ||
    !who.member.emailVerified ||
    !isAdmin(who.member.email, env.ADMIN_EMAILS)
  )
    throw new UserError(NOT_FOUND)
  return {
    db,
    admin: who.member,
    sessionId: who.sessionId,
    scope: (householdId) => householdDatabase(getDb(), householdId),
  }
}

const PERSONA_ID = z.string().regex(/^demo_[0-9a-f]{32}$/)
const LABEL = z.string().trim().min(1).max(MAX_LABEL).regex(LABEL_PATTERN)
const NOTHING = z.undefined()
const PERSONA = z.object({ personaId: PERSONA_ID }).strict()

export const ADMIN_INPUTS = {
  personas: NOTHING,
  createPersona: z.object({ label: LABEL }).strict(),
  actAs: PERSONA,
  exitDemo: NOTHING,
  reset: PERSONA,
  deletePersona: PERSONA,
  replayInvite: z.object({ fromPersonaId: PERSONA_ID, label: LABEL }).strict(),
}

type Inputs = {
  [K in keyof typeof ADMIN_INPUTS]: z.infer<(typeof ADMIN_INPUTS)[K]>
}

export const ADMIN_ACTIONS = {
  personas: (c: AdminContext) => listPersonas(c.db, c.scope, c.sessionId),
  createPersona: (c: AdminContext, d: Inputs['createPersona']) =>
    createPersona(c.db, c.admin.id, d.label),
  actAs: (c: AdminContext, d: Inputs['actAs']) =>
    startDemo(c.db, c.sessionId, c.admin.id, d.personaId),
  exitDemo: (c: AdminContext) => stopDemo(c.db, c.sessionId, c.admin.id),
  reset: (c: AdminContext, d: Inputs['reset']) =>
    resetPersona(c.db, c.admin.id, d.personaId),
  deletePersona: (c: AdminContext, d: Inputs['deletePersona']) =>
    deletePersona(c.db, c.admin.id, d.personaId),
  replayInvite: (c: AdminContext, d: Inputs['replayInvite']) =>
    replayInvite(c.db, c.scope, c.admin.id, d.fromPersonaId, d.label),
}

export type AdminAction = keyof typeof ADMIN_ACTIONS

/** The admin check first, then the input, then the action. */
export async function runAdmin<TName extends AdminAction>(
  name: TName,
  data: unknown,
): Promise<Awaited<ReturnType<(typeof ADMIN_ACTIONS)[TName]>>> {
  const context = await requireAdmin()
  const input = ADMIN_INPUTS[name].parse(data)
  const action = ADMIN_ACTIONS[name] as (
    c: AdminContext,
    d: unknown,
  ) => Promise<Awaited<ReturnType<(typeof ADMIN_ACTIONS)[TName]>>>
  return action(context, input)
}
