/**
 * Where everyday spending went, as two rings: Need, Nice and Fluff on the
 * outside, and inside each its Categories, biggest first. Only the biggest
 * few get a slice (and a color) of their own; the rest, and any too small
 * to see, fold into one slice per tag.
 */

import { TAGS, TAG_LABELS } from './types'
import type { CategoryMonth, MonthView } from './month'
import type { Tag } from './types'

/** A Category smaller than this share of everyday folds with the others. */
const MIN_SHARE = 0.03

export interface RingSlice {
  name: string
  tag: Tag
  value: number
  /** The Category, or null for a folded slice. */
  category: CategoryMonth | null
  /** What a folded slice holds, biggest first. */
  folded: Array<CategoryMonth>
  /** Its place among the Categories shown on their own, biggest 0; null when folded. */
  rank: number | null
}

export interface Rings {
  total: number
  /** Outer ring, in tag order; tags with nothing spent left out. */
  tags: Array<{ tag: Tag; value: number }>
  /** Inner ring, grouped under the outer ring's tags. */
  slices: Array<RingSlice>
}

/** `top`: how many Categories may have a slice of their own (one per color). */
export function everydayRings(view: MonthView, top: number): Rings {
  const spent = view.everyday
    .filter((c) => c.spent > 0)
    .sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name))
  const total = spent.reduce((n, c) => n + c.spent, 0)
  const shown = spent.filter((c) => c.spent >= MIN_SHARE * total).slice(0, top)
  const tags: Rings['tags'] = []
  const slices: Array<RingSlice> = []
  for (const tag of TAGS) {
    const cats = spent
      .filter((c) => c.tag === tag)
      .sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name))
    const value = cats.reduce((n, c) => n + c.spent, 0)
    if (value <= 0) continue
    tags.push({ tag, value })
    for (const c of cats.filter((k) => shown.includes(k)))
      slices.push({
        name: c.name,
        tag,
        value: c.spent,
        category: c,
        folded: [],
        rank: shown.indexOf(c),
      })
    const rest = cats.filter((k) => !shown.includes(k))
    if (rest.length === 1)
      slices.push({
        name: rest[0].name,
        tag,
        value: rest[0].spent,
        category: rest[0],
        folded: [],
        rank: null,
      })
    else if (rest.length > 1)
      slices.push({
        name: `${rest.length} more ${TAG_LABELS[tag]}`,
        tag,
        value: rest.reduce((n, c) => n + c.spent, 0),
        category: null,
        folded: rest,
        rank: null,
      })
  }
  return { total, tags, slices }
}
