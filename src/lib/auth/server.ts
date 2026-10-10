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

export function getAuth(env: CloudflareEnv, baseURL?: string) {
  return betterAuth({
    baseURL: baseURL ?? env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(dbFromD1(env.DB), { provider: 'sqlite', schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
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
