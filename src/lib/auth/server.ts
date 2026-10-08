/**
 * Better Auth server, configured as sportsline: Google sign-in only, Drizzle
 * adapter on D1. Unlike sportsline, only allowlisted emails get an account
 * (docs/adr/0001).
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { isAllowed } from './allowlist'
import type { CloudflareEnv } from '@/lib/db'
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
          // A stranger's Google sign-in ends here: no user row, no session.
          before: (user) =>
            Promise.resolve(isAllowed(user.email, env.ALLOWED_EMAILS)),
        },
      },
    },
  })
}
