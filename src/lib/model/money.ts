/** Formatting and parsing of integer cents. */

const whole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const exact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** "$1,235" (rounded to the dollar). */
export function dollars(cents: number): string {
  return whole.format(Math.round(cents / 100))
}

/** "$1,234.56" */
export function money(cents: number): string {
  return exact.format(cents / 100)
}

/** "+$120" / "−$80": a difference, signed. */
export function signedDollars(cents: number): string {
  const s = dollars(Math.abs(cents))
  if (Math.round(cents / 100) === 0) return s
  return cents > 0 ? `+${s}` : `−${s}`
}

/** Parse "1,234.5" or "$80" into cents; null when it isn't a number. */
export function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
