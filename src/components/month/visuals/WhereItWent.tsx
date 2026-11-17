/**
 * Where it went: everyday spending as a donut, Need, Nice and Fluff on the
 * outer ring and each one's Categories inside, the total in the middle.
 * Beside it (below on a phone), the Categories ranked. Hover or touch a
 * slice to see it; tap one, or its row, for its Stores.
 */

import { useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { PaneHeader } from './PaneHeader'
import type { CategoryMonth, MonthView } from '@/lib/model/month'
import type { RingSlice } from '@/lib/model/rings'
import { everydayRings } from '@/lib/model/rings'
import { arcPath, arcs } from '@/lib/layout/donut'
import { TAG_LABELS } from '@/lib/model/types'
import { dollars } from '@/lib/model/money'
import { MIX_COLORS, MIX_REST, TAG_FILL } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWidth } from '@/components/shared/useWidth'

/** Side by side from this wide; stacked below it. */
const SIDE_BY_SIDE = 560
/** Between neighbouring slices, radians. */
const GAP = 0.014

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '0%'

function storesOf(c: CategoryMonth) {
  const by = new Map<string, number>()
  for (const t of c.txns) by.set(t.store, (by.get(t.store) ?? 0) + t.amount)
  return [...by]
    .map(([store, value]) => ({ store, value }))
    .sort((a, b) => b.value - a.value || a.store.localeCompare(b.store))
}

const isOver = (c: CategoryMonth | null) =>
  !!c && c.target !== null && c.spent > c.target

export function WhereItWent({ view }: { view: MonthView }) {
  const [ref, width] = useWidth()
  const rings = useMemo(() => everydayRings(view, MIX_COLORS.length), [view])
  /** The slice tapped, and a Category tapped within a folded one. */
  const [open, setOpen] = useState<RingSlice | null>(null)
  const [inner, setInner] = useState<CategoryMonth | null>(null)
  const [hover, setHover] = useState<RingSlice | null>(null)

  // The biggest Categories a color each, by rank; the rest gray.
  const colorOf = new Map(
    rings.slices.map((s) => [
      s,
      s.rank === null ? MIX_REST : MIX_COLORS[s.rank],
    ]),
  )
  const focus = hover ?? open
  const category = inner ?? open?.category ?? null

  const wide = width >= SIDE_BY_SIDE
  const size = wide ? 280 : Math.min(width, 260)
  const c = size / 2
  const outer = arcs(
    rings.tags.map((t) => t.value),
    GAP,
  )
  const slice = arcs(
    rings.slices.map((s) => s.value),
    GAP,
  )

  if (!rings.total)
    return (
      <p className="py-6 text-center text-sm text-muted">Nothing spent yet.</p>
    )

  const centre = category
    ? { label: category.name, value: category.spent }
    : focus
      ? { label: focus.name, value: focus.value }
      : null

  return (
    <div>
      <PaneHeader
        hint={
          open ? (
            <button
              type="button"
              onClick={() => (inner ? setInner(null) : setOpen(null))}
              className="inline-flex items-center gap-0.5 font-semibold text-accent"
            >
              <ChevronLeft size={14} aria-hidden />
              {inner ? open.name : 'All Categories'}
            </button>
          ) : (
            'Everyday, by Category'
          )
        }
      >
        <span className="flex flex-wrap gap-x-3 tabular-nums">
          {rings.tags.map((t) => (
            <span key={t.tag}>
              <span
                aria-hidden
                className="mr-1 inline-block size-2 rounded-full"
                style={{ background: TAG_FILL[t.tag] }}
              />
              {TAG_LABELS[t.tag]}{' '}
              <span className="font-semibold text-foreground">
                {percent(t.value, rings.total)}
              </span>
            </span>
          ))}
        </span>
      </PaneHeader>
      <div
        ref={ref}
        className={cn(
          'flex gap-4',
          wide ? 'flex-row items-center' : 'flex-col items-stretch',
        )}
      >
        <div className="relative shrink-0 self-center">
          <svg
            width={size}
            height={size}
            role="img"
            aria-label={`${dollars(rings.total)} everyday: ${rings.tags
              .map(
                (t) => `${TAG_LABELS[t.tag]} ${percent(t.value, rings.total)}`,
              )
              .join(', ')}.`}
            onPointerLeave={() => setHover(null)}
          >
            {rings.tags.map((t, i) => (
              <path
                key={t.tag}
                d={arcPath(c, c, c - 9, c - 2, outer[i])}
                fill={TAG_FILL[t.tag]}
                opacity={focus && focus.tag !== t.tag ? 0.3 : 1}
                className="transition-opacity"
              />
            ))}
            {rings.slices.map((s, i) => {
              const lit = !focus || focus === s
              return (
                <path
                  key={s.name}
                  d={arcPath(
                    c,
                    c,
                    c * 0.56,
                    focus === s ? c - 10 : c - 14,
                    slice[i],
                  )}
                  fill={colorOf.get(s)}
                  opacity={lit ? 1 : 0.3}
                  className="cursor-pointer transition-opacity"
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') setHover(s)
                  }}
                  onClick={() => {
                    setInner(null)
                    setOpen(open === s ? null : s)
                  }}
                />
              )
            })}
          </svg>
          {/* The total in the middle, or the slice in view. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[22%] text-center">
            <span className="w-full truncate text-xs text-muted">
              {centre ? centre.label : 'Everyday'}
            </span>
            <span className="text-xl font-bold tabular-nums">
              {dollars(centre ? centre.value : rings.total)}
            </span>
            {centre && (
              <span className="text-xs text-muted tabular-nums">
                {percent(centre.value, rings.total)} of everyday
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {category ? (
            <Stores category={category} color={colorOf.get(open!)!} />
          ) : (
            <ul className="divide-y divide-border">
              {(open ? open.folded : rankedSlices(rings.slices)).map((row) => {
                const isSlice = !('spent' in row)
                const name = row.name
                const value = isSlice ? row.value : row.spent
                const cat = isSlice ? row.category : row
                const over = isOver(cat)
                return (
                  <li key={name}>
                    <button
                      type="button"
                      aria-label={`${name}, ${dollars(value)}${over ? ', over Target' : ''}`}
                      onClick={() => (isSlice ? setOpen(row) : setInner(row))}
                      onPointerEnter={(e) => {
                        if (isSlice && e.pointerType === 'mouse') setHover(row)
                      }}
                      onPointerLeave={() => setHover(null)}
                      className="flex w-full items-center gap-2 py-1.5 text-left text-[13px] hover:bg-sunken/50"
                    >
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{
                          background: isSlice ? colorOf.get(row) : MIX_REST,
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span
                        className={cn(
                          'font-semibold tabular-nums',
                          over && 'text-over',
                        )}
                      >
                        {dollars(value)}
                      </span>
                      <span className="w-9 text-right text-xs text-muted tabular-nums">
                        {percent(value, rings.total)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/** The inner ring's slices, biggest first for reading. */
function rankedSlices(slices: Array<RingSlice>): Array<RingSlice> {
  return [...slices].sort((a, b) => b.value - a.value)
}

/** A Category's Stores, each with its share of the Category. */
function Stores({
  category,
  color,
}: {
  category: CategoryMonth
  color: string
}) {
  const stores = storesOf(category)
  const top = stores[0]?.value ?? 1
  return (
    <div>
      <ul className="space-y-1.5">
        {stores.map((s) => (
          <li key={s.store} className="text-[13px]">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">{s.store}</span>
              <span className="font-semibold tabular-nums">
                {dollars(s.value)}
              </span>
            </span>
            <span className="mt-0.5 block h-1.5 rounded-full bg-sunken">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(2, (s.value / top) * 100)}%`,
                  background: color,
                }}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">
        {category.txns.length} purchases at {stores.length} stores
        {category.target !== null && ` · Target ${dollars(category.target)}`}
      </p>
    </div>
  )
}
