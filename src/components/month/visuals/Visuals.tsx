/**
 * Overview's visuals, one at a time in one card: Pace, Where it went, Day
 * by day and Flow. Swipe, tap a tab or use the arrows (← → too, once the
 * card has focus); the one last shown is remembered on this device.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PaceChart } from './PaceChart'
import { WhereItWent } from './WhereItWent'
import { DayByDay } from './DayByDay'
import { FlowChart } from './FlowChart'
import type { MonthView } from '@/lib/model/month'
import type { LedgerIndex } from '@/lib/model/ledger'
import type { Occurrence } from '@/lib/model/plans'
import { monthPace } from '@/lib/model/pace'
import { paydays as paydaysOf } from '@/lib/model/pay'
import { lastDayOf } from '@/lib/model/dates'
import { cn } from '@/lib/utils'

const VISUALS = [
  { key: 'pace', label: 'Pace' },
  { key: 'where', label: 'Where it went' },
  { key: 'days', label: 'Day by day' },
  { key: 'flow', label: 'Flow' },
] as const

type VisualKey = (typeof VISUALS)[number]['key']

/** localStorage key for the visual last shown. */
export const VISUAL_KEY = 'budgy:overview-visual'

/** How far a swipe must travel, in px, to turn to the next visual. */
const SWIPE = 50

function remembered(): number {
  try {
    const key = localStorage.getItem(VISUAL_KEY)
    return Math.max(
      0,
      VISUALS.findIndex((v) => v.key === key),
    )
  } catch {
    return 0
  }
}

export function Visuals({
  view,
  ix,
  occurrences,
  today,
  takeHome,
}: {
  view: MonthView
  ix: LedgerIndex
  occurrences: Array<Occurrence>
  today: string
  /** Take-home landing in the month; null under a Lens. */
  takeHome: number | null
}) {
  const [index, setIndex] = useState(0)
  // After mount: the server can't know this device's choice.
  useEffect(() => setIndex(remembered()), [])
  const show = (i: number) => {
    const next = (i + VISUALS.length) % VISUALS.length
    setIndex(next)
    try {
      localStorage.setItem(VISUAL_KEY, VISUALS[next].key)
    } catch {
      // Private browsing: remembered for this visit only.
    }
  }

  const month = view.month
  const pace = useMemo(
    () => monthPace(ix, view, today, occurrences),
    [ix, view, today, occurrences],
  )
  const paydays = useMemo(
    () =>
      ix.ledger.pay.flatMap((s) =>
        paydaysOf(s, `${month}-01`, lastDayOf(month)),
      ),
    [ix, month],
  )
  const bills = useMemo(
    () => occurrences.filter((o) => o.due.slice(0, 7) === month),
    [occurrences, month],
  )

  // Swipe: the visuals follow the finger, then settle on the nearest.
  const [drag, setDrag] = useState(0)
  const touch = useRef<{
    x: number
    y: number
    id: number
    /** Decided once per touch: sideways (true) or the page scrolling. */
    sideways?: boolean
  } | null>(null)

  // The card is as tall as the visual showing, not the tallest one.
  const panes = useRef<Array<HTMLDivElement | null>>([])
  const [height, setHeight] = useState<number>()
  useEffect(() => {
    const el = panes.current[index]
    if (!el) return
    setHeight(el.offsetHeight)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [index])

  const pane = (key: VisualKey) => {
    switch (key) {
      case 'pace':
        return (
          <PaceChart pace={pace} view={view} paydays={paydays} bills={bills} />
        )
      case 'where':
        return <WhereItWent view={view} />
      case 'days':
        return (
          <DayByDay view={view} today={today} paydays={paydays} bills={bills} />
        )
      case 'flow':
        return <FlowChart view={view} takeHome={takeHome} />
    }
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Visuals"
      tabIndex={-1}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, select')) return
        if (e.key === 'ArrowLeft') show(index - 1)
        else if (e.key === 'ArrowRight') show(index + 1)
      }}
      className="rounded-xl border border-border bg-surface p-3 outline-none"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Visual"
          className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]"
        >
          {VISUALS.map((v, i) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              id={`visual-tab-${v.key}`}
              aria-controls={`visual-${v.key}`}
              aria-selected={i === index}
              tabIndex={i === index ? 0 : -1}
              onClick={() => show(i)}
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition',
                i === index
                  ? 'bg-foreground text-surface'
                  : 'text-muted hover:bg-sunken hover:text-foreground',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        {/* A phone has swipe and the tabs; the arrows would crowd them. */}
        <div className="hidden shrink-0 items-center sm:flex">
          <button
            type="button"
            onClick={() => show(index - 1)}
            aria-label="Previous visual"
            className="rounded-full p-1.5 text-muted hover:bg-sunken hover:text-foreground"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => show(index + 1)}
            aria-label="Next visual"
            className="rounded-full p-1.5 text-muted hover:bg-sunken hover:text-foreground"
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      </div>
      <div
        data-testid="visuals-viewport"
        className="touch-pan-y overflow-hidden transition-[height] duration-300"
        style={{ height }}
        onPointerDown={(e) => {
          // A mouse clicks into the visuals; only touch and pen swipe.
          if (e.pointerType === 'mouse') return
          touch.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
        }}
        onPointerMove={(e) => {
          const t = touch.current
          if (!t || t.id !== e.pointerId) return
          const dx = e.clientX - t.x
          const dy = e.clientY - t.y
          if (t.sideways === undefined) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
            t.sideways = Math.abs(dx) > Math.abs(dy)
          }
          if (t.sideways) setDrag(dx)
        }}
        onPointerUp={() => {
          const t = touch.current
          touch.current = null
          if (t?.sideways && Math.abs(drag) > SWIPE)
            show(index + (drag < 0 ? 1 : -1))
          setDrag(0)
        }}
        onPointerCancel={() => {
          touch.current = null
          setDrag(0)
        }}
      >
        <div
          className={cn(
            'flex items-start',
            drag === 0 && 'transition-transform duration-300 ease-out',
          )}
          style={{
            transform: `translateX(calc(${-index * 100}% + ${drag}px))`,
          }}
        >
          {VISUALS.map((v, i) => (
            <div
              key={v.key}
              ref={(el) => {
                panes.current[i] = el
              }}
              id={`visual-${v.key}`}
              role="tabpanel"
              aria-labelledby={`visual-tab-${v.key}`}
              aria-hidden={i !== index}
              inert={i !== index}
              className="w-full shrink-0"
            >
              {pane(v.key)}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
        {VISUALS.map((v, i) => (
          <span
            key={v.key}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === index ? 'w-4 bg-foreground' : 'w-1.5 bg-border',
            )}
          />
        ))}
      </div>
    </section>
  )
}
