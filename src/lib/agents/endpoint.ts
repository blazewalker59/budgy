/**
 * `/mcp`: Budgy's MCP server for Agents (docs/adr/0004). Each request
 * carries a Member's API token as `Authorization: Bearer bg_…`; one
 * JSON-RPC message per POST, answered with JSON.
 */

import { INSTRUCTIONS, WRITE_INSTRUCTIONS, budgyTools } from './tools'
import { handleMcp, parseError } from './mcp'
import { bearerToken, verifyToken } from './tokens'
import type { CloudflareEnv } from '@/lib/db'
import { dbFromD1 } from '@/lib/db'
import { canSignIn, canUseHousehold } from '@/lib/households/admission'
import { today } from '@/lib/model/dates'
import { householdDatabase } from '@/lib/households/scope'

export const MCP_PATH = '/mcp'
/** A year of CSV export fits comfortably. */
const MAX_BODY_BYTES = 6 * 1024 * 1024

export async function serveMcp(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  // No server-to-client stream: every reply comes back on its POST.
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'POST' },
    })
  }
  // Agents call from servers; a browser page on another site never may.
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return new Response('Forbidden', { status: 403 })
  }

  const db = dbFromD1(env.DB)
  const token = bearerToken(request.headers.get('authorization'))
  const caller = token ? await verifyToken(db, token) : null
  // Membership is checked by verifyToken; admission also preserves the
  // original Household's rollout allowlist without blocking invited partners.
  if (
    !caller ||
    !(await canSignIn(db, caller.memberEmail, env.ALLOWED_EMAILS)) ||
    !(await canUseHousehold(
      db,
      caller.memberEmail,
      caller.householdId,
      env.ALLOWED_EMAILS,
    ))
  ) {
    return new Response('A Budgy API token is required', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="budgy"' },
    })
  }

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) {
    return new Response('Request too large', { status: 413 })
  }
  let message: unknown
  try {
    message = JSON.parse(text)
  } catch {
    return Response.json(parseError, { status: 400 })
  }

  try {
    const reply = await handleMcp(
      message,
      budgyTools(householdDatabase(db, caller.householdId), caller, today()),
      caller.scopes.includes('write')
        ? `${INSTRUCTIONS} ${WRITE_INSTRUCTIONS}`
        : INSTRUCTIONS,
    )
    return reply === null
      ? new Response(null, { status: 202 })
      : Response.json(reply)
  } catch (error) {
    console.error('mcp', error)
    return new Response('Internal error', { status: 500 })
  }
}
