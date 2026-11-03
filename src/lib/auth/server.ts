/**
 * Better Auth server, configured as sportsline: Google sign-in only, Drizzle
 * adapter on D1. Closed rollout admits allowlisted creators, invitees and
 * existing Members, not arbitrary new sign-ins (docs/adr/0008).
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { CloudflareEnv } from '@/lib/db'
import { canSignIn } from '@/lib/households/admission'
import { dbFromD1 } from '@/lib/db'
import * as schema from '@/lib/db/schema'

/**
 * Google OAuth credentials. Production must have both secrets. Vite dev and
 * Vitest may omit them (DEV_MEMBER_EMAIL, or auth mocked in tests) and still
 * boot; a half-set pair is a misconfiguration in every environment.
 */
const LOCAL = import.meta.env.DEV || import.meta.env.MODE === 'test'

function googleCredentials(env: CloudflareEnv): {
  clientId: string
  clientSecret: string
} {
  const clientId = env.GOOGLE_CLIENT_ID
  const clientSecret = env.GOOGLE_CLIENT_SECRET
  if (clientId && clientSecret) return { clientId, clientSecret }
  if (LOCAL && !clientId && !clientSecret) {
    return { clientId: '', clientSecret: '' }
  }
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set')
}

/**
 * Where Better Auth lives and what signs its cookies. A deployment without
 * them would fall back to a guessed URL and a default secret, so it refuses
 * to start instead; local development and tests may omit them. Over HTTPS,
 * cookies are `__Secure-` and Secure.
 */
export function authBase(env: CloudflareEnv, local = LOCAL) {
  const baseURL = env.BETTER_AUTH_URL
  const secret = env.BETTER_AUTH_SECRET
  if (!local && (!baseURL || !secret))
    throw new Error('BETTER_AUTH_URL and BETTER_AUTH_SECRET must both be set')
  return {
    baseURL,
    secret,
    useSecureCookies: baseURL?.startsWith('https://') ?? false,
  }
}

export function getAuth(env: CloudflareEnv) {
  const google = googleCredentials(env)
  const base = authBase(env)
  return betterAuth({
    // Same base URL session reads. The request host is not a second source.
    baseURL: base.baseURL,
    secret: base.secret,
    database: drizzleAdapter(dbFromD1(env.DB), { provider: 'sqlite', schema }),
    socialProviders: {
      google: {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
      },
    },
    // Google is the only provider, so there is nothing to link. Linking would
    // let a Google identity whose email isn't verified take over an existing
    // user with that email.
    account: {
      accountLinking: { enabled: false },
    },
    // On by default only when NODE_ENV is production, which Workers don't
    // set; in memory it would be per isolate. D1 keeps one count.
    rateLimit: { enabled: true, storage: 'database' },
    advanced: {
      useSecureCookies: base.useSecureCookies,
      // Cloudflare sets this from the connection; a client can't forge it.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    databaseHooks: {
      user: {
        create: {
          // Invitation admission allows first-time partner sign-in without
          // changing deployment secrets; it does not join their Household.
          before: (user) =>
            canSignIn(dbFromD1(env.DB), user.email, env.ALLOWED_EMAILS),
        },
      },
    },
  })
}
