/**
 * The Lens: one set of filters over the Household's purchases that follows
 * a Member from screen to screen (in the URL, so a view can be shared or
 * saved). Filters of one kind widen it (two Stores: either), filters of
 * different kinds narrow it (a Store and a person: both). The ⌘K palette
 * builds a Lens from what's typed (parseQuery). Pure.
 */

import { z } from 'zod'
import { addDays, lastDayOf, monthLabel, shiftMonth } from './dates'
import { categoryOf, ownerOf, tagOf } from './ledger'
import {
  ACCOUNT_KINDS,
  ACCOUNT_KIND_LABELS,
  OWNERS,
  TAGS,
  TAG_LABELS,
} from './types'
import type { LedgerIndex } from './ledger'
import type { AccountKind, Tag, Txn } from './types'

export type Flag = 'refunds' | 'planned' | 'uncategorized' | 'big'
export const FLAGS: ReadonlyArray<Flag> = [
  'refunds',
  'planned',
  'uncategorized',
  'big',
]
export const FLAG_LABELS: Record<Flag, string> = {
  refunds: 'Refunds',
  planned: 'Planned bills',
  uncategorized: 'Uncategorized',
  big: '$300 and up',
}
/** A purchase this big is "big". */
export const BIG = 30_000
export const UNCATEGORIZED = 'Uncategorized'

export interface Lens {
  people?: Array<string>
  accounts?: Array<string>
  kinds?: Array<AccountKind>
  stores?: Array<string>
  categories?: Array<string>
  tags?: Array<Tag>
  flags?: Array<Flag>
  /** Cents, either side of the amount (refunds by their size). */
  min?: number
  max?: number
  /** YYYY-MM-DD, inclusive. */
  from?: string
  to?: string
  /** In the Store, description or note. */
  q?: string
}

/** One filter, as the palette offers and the chips show it. */
export type LensFilter =
  | { type: 'person'; value: string }
  | { type: 'account'; value: string }
  | { type: 'kind'; value: AccountKind }
  | { type: 'store'; value: string }
  | { type: 'category'; value: string }
  | { type: 'tag'; value: Tag }
  | { type: 'flag'; value: Flag }
  | { type: 'amount'; min?: number; max?: number }
  | { type: 'when'; from: string; to: string }
  | { type: 'text'; value: string }

const LIST_KEYS = {
  person: 'people',
  account: 'accounts',
  kind: 'kinds',
  store: 'stores',
  category: 'categories',
  tag: 'tags',
  flag: 'flags',
} as const

export function isEmpty(lens: Lens): boolean {
  return filtersOf(lens).length === 0
}

/** The Lens as separate filters, in the order chips show them. */
export function filtersOf(lens: Lens): Array<LensFilter> {
  const out: Array<LensFilter> = []
  for (const value of lens.people ?? []) out.push({ type: 'person', value })
  for (const value of lens.accounts ?? []) out.push({ type: 'account', value })
  for (const value of lens.kinds ?? []) out.push({ type: 'kind', value })
  for (const value of lens.stores ?? []) out.push({ type: 'store', value })
  for (const value of lens.categories ?? [])
    out.push({ type: 'category', value })
  for (const value of lens.tags ?? []) out.push({ type: 'tag', value })
  for (const value of lens.flags ?? []) out.push({ type: 'flag', value })
  if (lens.min !== undefined || lens.max !== undefined)
    out.push({ type: 'amount', min: lens.min, max: lens.max })
  if (lens.from && lens.to)
    out.push({ type: 'when', from: lens.from, to: lens.to })
  if (lens.q) out.push({ type: 'text', value: lens.q })
  return out
}

function tidy(lens: Lens): Lens {
  const out: Lens = {}
  for (const [k, v] of Object.entries(lens) as Array<[keyof Lens, unknown]>) {
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  return out
}

/** The Lens with a filter added; an amount or a date range replaces the last. */
export function withFilter(lens: Lens, f: LensFilter): Lens {
  if (f.type === 'amount') return tidy({ ...lens, min: f.min, max: f.max })
  if (f.type === 'when') return tidy({ ...lens, from: f.from, to: f.to })
  if (f.type === 'text') return tidy({ ...lens, q: f.value })
  const key = LIST_KEYS[f.type]
  const list = (lens[key] ?? []) as Array<string>
  if (list.includes(f.value)) return lens
  return tidy({ ...lens, [key]: [...list, f.value] })
}

/** The Lens with that filter in, or out if it was already in. */
export function toggleFilter(lens: Lens, f: LensFilter): Lens {
  return hasFilter(lens, f) ? withoutFilter(lens, f) : withFilter(lens, f)
}

export function hasFilter(lens: Lens, f: LensFilter): boolean {
  return filtersOf(lens).some((x) => filterKey(x) === filterKey(f))
}

export function withoutFilter(lens: Lens, f: LensFilter): Lens {
  if (f.type === 'amount')
    return tidy({ ...lens, min: undefined, max: undefined })
  if (f.type === 'when')
    return tidy({ ...lens, from: undefined, to: undefined })
  if (f.type === 'text') return tidy({ ...lens, q: undefined })
  const key = LIST_KEYS[f.type]
  return tidy({
    ...lens,
    [key]: ((lens[key] ?? []) as Array<string>).filter((v) => v !== f.value),
  })
}

export function filterKey(f: LensFilter): string {
  switch (f.type) {
    case 'amount':
      return `amount:${f.min ?? ''}-${f.max ?? ''}`
    case 'when':
      return `when:${f.from}-${f.to}`
    default:
      return `${f.type}:${f.value}`
  }
}

/** Only the parts of a Lens a screen honors (Plan: people). */
export function pick(lens: Lens, keys: Array<keyof Lens>): Lens {
  return tidy(Object.fromEntries(keys.map((k) => [k, lens[k]])) as Lens)
}

// ─── Matching ────────────────────────────────────────────────────────────

export function matchLens(
  ix: LedgerIndex,
  t: Txn,
  lens: Lens,
  plannedIds: Set<string>,
): boolean {
  if (lens.from && t.date < lens.from) return false
  if (lens.to && t.date > lens.to) return false
  const size = Math.abs(t.amount)
  if (lens.min !== undefined && size < lens.min) return false
  if (lens.max !== undefined && size > lens.max) return false
  if (lens.people?.length && !lens.people.includes(ownerOf(ix, t))) return false
  if (lens.accounts?.length && !lens.accounts.includes(t.account)) return false
  if (lens.kinds?.length) {
    const kind = ix.ledger.accounts.find((a) => a.name === t.account)?.kind
    if (!kind || !lens.kinds.includes(kind)) return false
  }
  if (lens.stores?.length && !lens.stores.includes(t.store)) return false
  if (lens.categories?.length && !lens.categories.includes(categoryOf(ix, t)))
    return false
  if (lens.tags?.length && !lens.tags.includes(tagOf(ix, t))) return false
  if (
    lens.flags?.length &&
    !lens.flags.some((f) =>
      f === 'refunds'
        ? t.amount < 0
        : f === 'planned'
          ? plannedIds.has(t.id)
          : f === 'big'
            ? t.amount >= BIG
            : categoryOf(ix, t) === UNCATEGORIZED,
    )
  )
    return false
  const q = lens.q?.trim().toLowerCase()
  if (
    q &&
    !t.store.toLowerCase().includes(q) &&
    !t.description.toLowerCase().includes(q) &&
    !(t.note ?? '').toLowerCase().includes(q)
  )
    return false
  return true
}

// ─── URL ─────────────────────────────────────────────────────────────────

const strings = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z.array(z.string().trim().min(1).max(max)).max(30),
  )
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const CENTS = z.coerce.number().int().min(0).max(10_000_000_000)

const lensSchema = z.object({
  people: strings(40),
  accounts: strings(60),
  kinds: z.preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z.array(z.enum(ACCOUNT_KINDS as [AccountKind, ...Array<AccountKind>])),
  ),
  stores: strings(80),
  categories: strings(60),
  tags: z.preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z.array(z.enum(TAGS as [Tag, ...Array<Tag>])),
  ),
  flags: z.preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z.array(z.enum(FLAGS as [Flag, ...Array<Flag>])),
  ),
  min: CENTS,
  max: CENTS,
  from: DATE,
  to: DATE,
  q: z.string().trim().min(1).max(200),
})

/** A Lens from untrusted input (the URL, a saved Lens): bad parts dropped. */
export function readLens(input: Record<string, unknown>): Lens {
  const out: Lens = {}
  for (const key of Object.keys(lensSchema.shape) as Array<keyof Lens>) {
    if (input[key] === undefined) continue
    const parsed = lensSchema.shape[key].safeParse(input[key])
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data
  }
  if (
    (out.from && !out.to) ||
    (out.to && !out.from) ||
    (out.from && out.to && out.from > out.to)
  ) {
    delete out.from
    delete out.to
  }
  return tidy(out)
}

/** Every Lens key, cleared: for a search update that drops the Lens. */
export const NO_LENS: Record<keyof Lens, undefined> = {
  people: undefined,
  accounts: undefined,
  kinds: undefined,
  stores: undefined,
  categories: undefined,
  tags: undefined,
  flags: undefined,
  min: undefined,
  max: undefined,
  from: undefined,
  to: undefined,
  q: undefined,
}

export const savedLensInput = z.object({
  id: z.string().regex(/^ln_[a-z0-9]{6,24}$/),
  name: z.string().trim().min(1).max(40),
  lens: z
    .record(z.string(), z.unknown())
    .transform((l) => readLens(l))
    .refine((l) => !isEmpty(l), 'A saved lens needs at least one filter'),
})

// ─── Words ───────────────────────────────────────────────────────────────

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`

function shortDate(date: string): string {
  return `${monthLabel(date.slice(0, 7)).slice(0, 3)} ${Number(date.slice(8))}`
}

/** "Sep 2026" for a whole month, else "Jul 1 – Oct 8". */
export function whenLabel(from: string, to: string): string {
  const m = from.slice(0, 7)
  if (from === `${m}-01` && to === lastDayOf(m)) return monthLabel(m)
  if (from === `${m}-01` && to.slice(0, 7) === m)
    return `${monthLabel(m)} so far`
  return `${shortDate(from)} – ${shortDate(to)}`
}

/** What a chip says: the kind of filter, and its value. */
export function filterLabel(f: LensFilter): [kind: string, value: string] {
  switch (f.type) {
    case 'person':
      return ['Person', f.value]
    case 'account':
      return ['Account', f.value]
    case 'kind':
      return ['Type', ACCOUNT_KIND_LABELS[f.value]]
    case 'store':
      return ['Store', f.value]
    case 'category':
      return ['Category', f.value]
    case 'tag':
      return ['Tag', TAG_LABELS[f.value]]
    case 'flag':
      return ['Only', FLAG_LABELS[f.value]]
    case 'when':
      return ['When', whenLabel(f.from, f.to)]
    case 'text':
      return ['Says', `“${f.value}”`]
    case 'amount':
      if (f.min !== undefined && f.min === f.max) return ['Amount', usd(f.min)]
      if (f.min !== undefined && f.max !== undefined)
        return ['Amount', `${usd(f.min)}–${usd(f.max)}`]
      return [
        'Amount',
        f.min !== undefined ? `${usd(f.min)} and up` : `up to ${usd(f.max!)}`,
      ]
  }
}

/** A Lens in a few words, for a saved Lens's hint. */
export function describe(lens: Lens): string {
  return filtersOf(lens)
    .map((f) => filterLabel(f)[1])
    .join(' · ')
}

// ─── Reading what's typed ────────────────────────────────────────────────

export interface Term {
  filter: LensFilter
  label: string
  /** Other words for it ("dining", "credit card"). */
  aliases: Array<string>
  /** What it is, for the palette ("Store · 42 purchases"). */
  hint: string
}

const KIND_WORDS: Partial<Record<AccountKind, Array<string>>> = {
  credit: ['credit card', 'credit cards', 'cards', 'credit'],
  checking: ['bank', 'debit'],
  savings: ['saving'],
  brokerage: ['investments', 'brokerage'],
  loan: ['loans', 'mortgage'],
}
const FLAG_WORDS: Record<Flag, Array<string>> = {
  refunds: ['refund', 'refunds', 'returns'],
  planned: ['planned', 'bills', 'planned bills'],
  uncategorized: ['uncategorized', 'unfiled', 'to file'],
  big: ['big', 'large', 'big purchases'],
}
const TAG_WORDS: Record<Tag, Array<string>> = {
  need: ['need', 'needs'],
  nice: ['nice', 'nice to have', 'nice to haves'],
  fluff: ['fluff', 'wants'],
}

/** Everything the palette can turn into a filter, from the Ledger. */
export function vocabulary(ix: LedgerIndex): Array<Term> {
  const terms: Array<Term> = []
  const people = new Set<string>(OWNERS)
  for (const a of ix.ledger.accounts) people.add(a.owner)
  for (const p of people)
    terms.push({
      filter: { type: 'person', value: p },
      label: p,
      aliases: p === 'Joint' ? ['ours', 'shared'] : [],
      hint: 'Person',
    })
  for (const a of ix.ledger.accounts)
    terms.push({
      filter: { type: 'account', value: a.name },
      label: a.name,
      aliases: [],
      hint: `${a.owner} · ${ACCOUNT_KIND_LABELS[a.kind]}`,
    })
  for (const k of new Set(ix.ledger.accounts.map((a) => a.kind)))
    terms.push({
      filter: { type: 'kind', value: k },
      label: ACCOUNT_KIND_LABELS[k],
      aliases: KIND_WORDS[k] ?? [],
      hint: 'Account type',
    })
  const stores = new Map<string, number>()
  const cats = new Map<string, number>()
  for (const t of ix.ledger.txns) {
    stores.set(t.store, (stores.get(t.store) ?? 0) + 1)
    const c = categoryOf(ix, t)
    cats.set(c, (cats.get(c) ?? 0) + 1)
  }
  for (const c of ix.categories.keys()) if (!cats.has(c)) cats.set(c, 0)
  for (const [s, n] of [...stores].sort((a, b) => b[1] - a[1]))
    terms.push({
      filter: { type: 'store', value: s },
      label: s,
      aliases: [],
      hint: `Store · ${n} purchase${n === 1 ? '' : 's'}`,
    })
  for (const [c, n] of cats)
    terms.push({
      filter: { type: 'category', value: c },
      label: c,
      aliases: c.includes('&') ? c.toLowerCase().split(/\s*&\s*/) : [],
      hint: `Category · ${n} purchase${n === 1 ? '' : 's'}`,
    })
  for (const tag of TAGS)
    terms.push({
      filter: { type: 'tag', value: tag },
      label: TAG_LABELS[tag],
      aliases: TAG_WORDS[tag],
      hint: 'Tag',
    })
  for (const flag of FLAGS)
    terms.push({
      filter: { type: 'flag', value: flag },
      label: FLAG_LABELS[flag],
      aliases: FLAG_WORDS[flag],
      hint: 'Kind of purchase',
    })
  return terms
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]

function money(word: string | undefined): number | null {
  const m = /^\$?(\d+(?:\.\d{1,2})?)(k?)$/.exec(word ?? '')
  if (!m) return null
  return Math.round(Number(m[1]) * (m[2] ? 1000 : 1) * 100)
}

function amountAt(
  words: Array<string>,
  i: number,
): [LensFilter, number] | null {
  const [w, a, b, c] = words.slice(i, i + 4)
  let m
  if ((m = /^\$?(\d+(?:\.\d{1,2})?)-\$?(\d+(?:\.\d{1,2})?)$/.exec(w)))
    return [{ type: 'amount', min: money(m[1])!, max: money(m[2])! }, 1]
  if ((m = /^([<>])=?(\$?\d+(?:\.\d{1,2})?k?)$/.exec(w))) {
    const v = money(m[2])
    if (v !== null)
      return [
        { type: 'amount', ...(m[1] === '>' ? { min: v } : { max: v }) },
        1,
      ]
  }
  if (['over', 'above'].includes(w) && money(a) !== null)
    return [{ type: 'amount', min: money(a)! }, 2]
  if (w === 'more' && a === 'than' && money(b) !== null)
    return [{ type: 'amount', min: money(b)! }, 3]
  if (['under', 'below'].includes(w) && money(a) !== null)
    return [{ type: 'amount', max: money(a)! }, 2]
  if (w === 'less' && a === 'than' && money(b) !== null)
    return [{ type: 'amount', max: money(b)! }, 3]
  if (w === 'between' && money(a) !== null && b === 'and' && money(c) !== null)
    return [{ type: 'amount', min: money(a)!, max: money(c)! }, 4]
  // An exact charge: "84.12" or "$84".
  if (/^\$?\d+\.\d{2}$/.test(w) || /^\$\d+$/.test(w))
    return [{ type: 'amount', min: money(w)!, max: money(w)! }, 1]
  return null
}

function whenAt(
  words: Array<string>,
  i: number,
  today: string,
): [LensFilter, number] | null {
  const [w, a, b] = words.slice(i, i + 3)
  const thisMonth = today.slice(0, 7)
  const span = (from: string, to: string, n: number): [LensFilter, number] => [
    { type: 'when', from, to: to > today ? today : to },
    n,
  ]
  if (w === 'today') return span(today, today, 1)
  if (w === 'yesterday') return span(addDays(today, -1), addDays(today, -1), 1)
  if (w === 'this' && a === 'month') return span(`${thisMonth}-01`, today, 2)
  if (w === 'this' && a === 'week') return span(addDays(today, -6), today, 2)
  if (w === 'this' && a === 'year')
    return span(`${today.slice(0, 4)}-01-01`, today, 2)
  if (w === 'last' && a === 'month') {
    const m = shiftMonth(thisMonth, -1)
    return span(`${m}-01`, lastDayOf(m), 2)
  }
  if (w === 'last' && a === 'week')
    return span(addDays(today, -13), addDays(today, -7), 2)
  if (w === 'last' && a === 'year') {
    const y = Number(today.slice(0, 4)) - 1
    return span(`${y}-01-01`, `${y}-12-31`, 2)
  }
  if (
    w === 'last' &&
    /^\d+$/.test(a ?? '') &&
    /^(days?|months?)$/.test(b ?? '')
  ) {
    const n = Number(a)
    if (b!.startsWith('day')) return span(addDays(today, -(n - 1)), today, 3)
    return span(`${shiftMonth(thisMonth, -n)}-01`, today, 3)
  }
  const mi = MONTHS.indexOf((w ?? '').slice(0, 3))
  if (
    mi >= 0 &&
    /^[a-z]+$/.test(w) &&
    (w.length === 3 ||
      'january february march april may june july august september sept october november december'
        .split(' ')
        .includes(w))
  ) {
    // The latest such month that has started.
    let y = Number(today.slice(0, 4))
    if (mi + 1 > Number(today.slice(5, 7))) y--
    const year = /^\d{4}$/.test(a ?? '') ? Number(a) : y
    const m = `${year}-${String(mi + 1).padStart(2, '0')}`
    return span(`${m}-01`, lastDayOf(m), /^\d{4}$/.test(a ?? '') ? 2 : 1)
  }
  return null
}

function termFor(phrase: string, terms: Array<Term>): Term | null {
  if (phrase.length < 3) return null
  let best: { t: Term; score: number } | null = null
  for (const t of terms) {
    for (const name of [t.label.toLowerCase(), ...t.aliases]) {
      const score =
        name === phrase
          ? 3
          : phrase.length >= 4 && name.startsWith(phrase)
            ? 2
            : 0
      if (score > (best?.score ?? 0)) best = { t, score }
    }
  }
  return best?.t ?? null
}

/**
 * Read a query left to right into filters, the longest phrase first:
 * "kroger alex over 50 last month" is a Store, a person, an amount and a
 * month. Words that aren't any filter come back as `rest`.
 */
export function parseQuery(
  query: string,
  terms: Array<Term>,
  today: string,
): { filters: Array<LensFilter>; rest: Array<string> } {
  const words = query
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const filters: Array<LensFilter> = []
  const rest: Array<string> = []
  for (let i = 0; i < words.length;) {
    let hit = amountAt(words, i) ?? whenAt(words, i, today)
    if (!hit)
      for (let j = Math.min(words.length, i + 5); j > i && !hit; j--) {
        const t = termFor(words.slice(i, j).join(' '), terms)
        if (t) hit = [t.filter, j - i]
      }
    if (hit) {
      filters.push(hit[0])
      i += hit[1]
    } else rest.push(words[i++])
  }
  return { filters, rest }
}
