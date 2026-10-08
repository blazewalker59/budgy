/**
 * Who may use Budgy: the Household's Members, by email (docs/adr/0001).
 * Anyone else can complete Google sign-in but gets no account and no data.
 */

export function allowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isAllowed(email: string | null | undefined, raw?: string) {
  return Boolean(email) && allowedEmails(raw).has(email!.trim().toLowerCase())
}
