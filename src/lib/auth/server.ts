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
function googleCredentials(env: CloudflareEnv): {
  clientId: string
  clientSecret: string
} {
  const clientId = env.GOOGLE_CLIENT_ID
  const clientSecret = env.GOOGLE_CLIENT_SECRET
  if (clientId && clientSecret) return { clientId, clientSecret }
  if (
    (import.meta.env.DEV || import.meta.env.MODE === 'test') &&
    !clientId &&
    !clientSecret
  ) {
    return { clientId: '', clientSecret: '' }
  }
  throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set')
}

export function getAuth(env: CloudflareEnv) {
  const google = googleCredentials(env)
  return betterAuth({
    // Same base URL session reads. The request host is not a second source.
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(dbFromD1(env.DB), { provider: 'sqlite', schema }),
    socialProviders: {
      google: {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
      },
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
