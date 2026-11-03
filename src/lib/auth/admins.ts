/**
 * Who runs the demo sandbox (docs/adr/0015): `ADMIN_EMAILS`, parsed like
 * `ALLOWED_EMAILS`. Unset means no admins. Being an admin grants nothing
 * else: an admin still signs in and is admitted like anyone.
 */
import { allowedEmails } from './allowlist'
import { isDemoEmail } from '@/lib/demo/personas'

export function isAdmin(email: string | null | undefined, raw?: string) {
  if (!email || isDemoEmail(email)) return false
  return allowedEmails(raw).has(email.trim().toLowerCase())
}
