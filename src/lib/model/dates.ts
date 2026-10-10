/** Calendar arithmetic on YYYY-MM-DD and YYYY-MM strings, in UTC. */

const DAY_MS = 86_400_000

function parts(date: string): [number, number, number] {
  return [
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10) || '1'),
  ]
}

const pad = (n: number) => String(n).padStart(2, '0')

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `n` months after `date`, keeping the day but never past month end. */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = parts(date)
  const total = y * 12 + (m - 1) + n
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const day = Math.min(d, daysInMonth(year, month))
  return `${year}-${pad(month)}-${pad(day)}`
}

export function addDays(date: string, n: number): string {
  return new Date(toMs(date) + n * DAY_MS).toISOString().slice(0, 10)
}

function toMs(date: string): number {
  const [y, m, d] = parts(date)
  return Date.UTC(y, m - 1, d)
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS)
}

/** Whole calendar months from month `a` to month `b`. */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = parts(a)
  const [by, bm] = parts(b)
  return by * 12 + bm - (ay * 12 + am)
}

export function shiftMonth(month: string, n: number): string {
  return addMonths(`${month}-01`, n).slice(0, 7)
}

/** `count` months ending with `last`, oldest first. */
export function monthRange(last: string, count: number): Array<string> {
  return Array.from({ length: count }, (_, i) =>
    shiftMonth(last, i - count + 1),
  )
}

export function lastDayOf(month: string): string {
  const [y, m] = parts(month)
  return `${month}-${pad(daysInMonth(y, m))}`
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "Sep 2026", or "September 2026" when `long`. */
export function monthLabel(month: string, long = false): string {
  const [y, m] = parts(month)
  return `${(long ? LONG_MONTHS : MONTHS)[m - 1]} ${y}`
}

/** "Sep 14" */
export function dayLabel(date: string): string {
  const [, m, d] = parts(date)
  return `${MONTHS[m - 1]} ${d}`
}

/** "today", "tomorrow", "in 5 days", "in 3 weeks", "4 days ago". */
export function relativeDays(from: string, to: string): string {
  const n = daysBetween(from, to)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n < 0) return `${-n} days ago`
  if (n < 14) return `in ${n} days`
  if (n < 60) return `in ${Math.round(n / 7)} weeks`
  return `in ${Math.round(n / 30.4)} months`
}

/** Today's date in the Household's time zone. */
export function today(timeZone = 'America/New_York'): string {
  return dateOn(new Date(), timeZone)
}

/** The date a moment falls on in the Household's time zone. */
export function dateOn(at: Date, timeZone = 'America/New_York'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}
