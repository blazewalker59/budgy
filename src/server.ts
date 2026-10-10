/// <reference types="@cloudflare/workers-types" />
/**
 * Custom Cloudflare Worker entry (same shape as sportsline).
 *
 * Serves Better Auth (`/api/auth/*`), the health check and the MCP server
 * for Agents (`/mcp`, docs/adr/0004) directly;
 * everything else falls through to TanStack Start inside a per-request
 * context carrying the env.
 */

import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import type { CloudflareEnv } from '@/lib/db'
import { getAuth } from '@/lib/auth/server'
import { canonicalRedirect } from '@/lib/canonical'
import { serverRequestContext } from '@/lib/db'
import { MCP_PATH, serveMcp } from '@/lib/agents/endpoint'
import { serveUpload } from '@/lib/updates/uploadEndpoint'
import { syncAll } from '@/lib/updates/sync'
import { UPLOAD_PATH } from '@/lib/updates/exports'

const startFetch = createStartHandler(defaultStreamHandler) as (
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext,
) => Promise<Response>

export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // One canonical address (one sign-in): other hosts permanently redirect
    // to the same path on CANONICAL_HOST, when one is set.
    const redirect = canonicalRedirect(url, request.method, env.CANONICAL_HOST)
    if (redirect) return redirect

    if (url.pathname === '/health') {
      try {
        await env.DB.prepare('SELECT 1').first()
        return Response.json({
          ok: true,
          version: __BUDGY_VERSION__ || undefined,
        })
      } catch {
        return Response.json({ ok: false }, { status: 503 })
      }
    }

    // Agents sign in with an API token, not a session (docs/adr/0004).
    if (url.pathname === MCP_PATH) return serveMcp(request, env)
    if (url.pathname === UPLOAD_PATH) return serveUpload(request, env)

    if (url.pathname.startsWith('/api/auth')) {
      return getAuth(env).handler(request)
    }

    return serverRequestContext.run({ headers: request.headers, env }, () =>
      startFetch(request, env, ctx),
    )
  },

  // Cron (wrangler.jsonc): sync linked SimpleFIN accounts (docs/adr/0010).
  scheduled(
    _controller: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(syncAll(env.DB, env.BANK_CONNECTION_KEY))
  },
}
