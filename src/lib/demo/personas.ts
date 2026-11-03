/**
 * Demo personas (docs/adr/0015): synthetic people an admin acts as to walk
 * through what a new family sees. Their emails are at `demo.invalid`, a
 * domain reserved never to exist (RFC 2606), so no one can receive mail or
 * sign in with Google as one. Pure: shared by the server and the browser.
 */

export const DEMO_DOMAIN = 'demo.invalid'
export const MAX_LABEL = 30
export const MAX_PERSONAS = 50
export const LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u

/**
 * SimpleFIN's own reusable demo setup token (its protocol docs), which
 * claims https://bridge.simplefin.org/simplefin/claim/demo: fake accounts.
 */
export const SIMPLEFIN_DEMO_TOKEN =
  'aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy9zaW1wbGVmaW4vY2xhaW0vZGVtbw=='

export function isDemoEmail(email: string | null | undefined): boolean {
  return Boolean(email?.trim().toLowerCase().endsWith(`@${DEMO_DOMAIN}`))
}

/** What a persona is called everywhere it shows: "Sam (demo)". */
export function personaName(label: string): string {
  return `${label.trim()} (demo)`
}

/** `sam-k3j9x2@demo.invalid`: unique, and plainly not a person's address. */
export function personaEmail(label: string, random: string): string {
  const slug =
    label
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20) || 'persona'
  return `${slug}-${random}@${DEMO_DOMAIN}`
}
