/**
 * Better Auth browser client.
 *
 * baseURL defaults to the current origin, so the same client works in local
 * dev and production. `signIn.social({ provider: 'google' })` starts the
 * Google flow.
 */

import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()

export const { signIn, signOut } = authClient
