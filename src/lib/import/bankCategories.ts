/**
 * Bank categories: the category a bank or finance app gave a purchase
 * ("Restaurants"), and which of the Household's Categories each one means.
 * A Category's old name, after a rename, means the new one, so imports
 * still naming it land in the right place. Pure.
 */

/** Where the Household keeps what each Bank category means. */
export const BANK_CATEGORIES_KEY = 'bank-categories'

/** Bank categories match in any case, with spaces trimmed. */
export function bankKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Stored meanings (bank key → Category); anything broken is ignored. */
export function parseBankCategories(
  json: string | null | undefined,
): Map<string, string> {
  if (!json) return new Map()
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return new Map()
    return new Map(
      Object.entries(parsed).filter(
        (e): e is [string, string] =>
          typeof e[1] === 'string' && e[0].length > 0 && e[1].length > 0,
      ),
    )
  } catch {
    return new Map()
  }
}

export function storeBankCategories(map: ReadonlyMap<string, string>): string {
  return JSON.stringify(Object.fromEntries(map))
}

/**
 * The Category a bank's name files to: the Household's own Category of that
 * name (any case) first, else what a Member said it means.
 */
export function resolveBankCategory(
  name: string,
  categories: ReadonlyMap<string, string>,
  meanings: ReadonlyMap<string, string>,
): string | undefined {
  const key = bankKey(name)
  const own = categories.get(key)
  if (own) return own
  const meant = meanings.get(key)
  return meant ? (categories.get(meant.toLowerCase()) ?? meant) : undefined
}
