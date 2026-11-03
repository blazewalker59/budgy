import { UserError } from '@/lib/errors'
/**
 * A Household's basics as a Member sets them: its time zone and the people
 * in it. Pure, so the browser and the server check them the same way.
 */

export const JOINT = 'Joint'
/** People a Household can name, besides Joint. */
export const MAX_PEOPLE = 12
export const MAX_PERSON = 40

/** Every zone this runtime knows (Intl), UTC included. */
export function timeZones(): Array<string> {
  try {
    const zones = Intl.supportedValuesOf('timeZone')
    return zones.includes('UTC') ? zones : [...zones, 'UTC']
  } catch {
    return ['UTC']
  }
}

/**
 * A zone a Member may choose: one Intl lists (or UTC), so a typo or an
 * obsolete alias never becomes a Household's calendar.
 */
export function isTimeZone(value: string): boolean {
  return timeZones().includes(value)
}

/** This device's zone, when it's one a Household may use. */
export function deviceTimeZone(fallback: string): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && isTimeZone(zone) ? zone : fallback
  } catch {
    return fallback
  }
}

/** "America/New_York" as "New York (America)". */
export function zoneLabel(zone: string): string {
  const parts = zone.split('/')
  if (parts.length === 1) return zone
  const place = parts.slice(1).join(' / ').replaceAll('_', ' ')
  return `${place} (${parts[0]})`
}

/**
 * The people a Member typed, made into the Household's owners: trimmed,
 * once each in any case, Joint always first.
 */
export function cleanOwners(people: ReadonlyArray<string>): Array<string> {
  const seen = new Set([JOINT.toLowerCase()])
  const out = [JOINT]
  for (const raw of people) {
    const name = raw.trim().replace(/\s+/g, ' ')
    if (!name) continue
    if (name.length > MAX_PERSON)
      throw new UserError(`Keep each name to ${MAX_PERSON} characters`)
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  if (out.length > MAX_PEOPLE + 1)
    throw new UserError(`Name up to ${MAX_PEOPLE} people`)
  return out
}

/** A Member's first name, as the first person to suggest. */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return first.slice(0, MAX_PERSON)
}
