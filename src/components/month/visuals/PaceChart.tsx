/**
 * Pace: this month's everyday spending adding up day by day (red once it's
 * past the Budget's even pace), over the range earlier months had spent by
 * each day, with paydays and planned bills pinned along the bottom. Hover
 * or touch a day for its running total and biggest purchases.
 */

import { useState } from 'react'
import { PaneHeader } from './PaneHeader'
import type { MonthPace } from '@/lib/model/pace'
import type { MonthView } from '@/lib/model/month'
import type { Occurrence } from '@/lib/model/plans'
import { dayLabel } from '@/lib/model/dates'
import { compactDollars, dollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'
import { niceTicks } from '@/lib/layout/ticks'
import { useWidth } from '@/components/shared/useWidth'

const HEIGHT = 220
/** Under the plot: a row of bills, a row of paydays, then the dates. */
const PAD = { left: 40, right: 12, top: 10, bottom: 46 }

export function PaceChart({
  pace,
  view,
  paydays,
  bills,
}: {
  pace: MonthPace
  view: MonthView
  /** Paydays in the month. */
  paydays: Array<string>
  /** Planned bills due in the month. */
  bills: Array<Occurrence>
}) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const days = pace.daily.length
  const dateOf = (day: number) =>
    `${view.month}-${String(day + 1).padStart(2, '0')}`
  const dayOf = (date: string) => Number(date.slice(8, 10)) - 1

  const ticks = niceTicks(
    Math.max(pace.target, pace.spent, ...(pace.usual ?? []).map((u) => u.high)),
  )
  const max = ticks[ticks.length - 1]
  const x = (day: number) =>
    PAD.left + (day / Math.max(1, days - 1)) * (width - PAD.left - PAD.right)
  const y = (cents: number) =>
    PAD.top + (1 - cents / max) * (HEIGHT - PAD.top - PAD.bottom)
  const line = (values: Array<number>) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')
  const over = pace.overPace > 0
  const color = over ? 'var(--color-over)' : 'var(--color-accent)'
  const soFar = pace.total.slice(0, pace.today + 1)
  const dayAt = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const share =
      (e.clientX - r.left - PAD.left) / (width - PAD.left - PAD.right)
    return Math.max(0, Math.min(days - 1, Math.round(share * (days - 1))))
  }
  const bottom = HEIGHT - PAD.bottom

  return (
    <div>
      <PaneHeader
        hint={
          pace.months
            ? `Everyday, against your last ${pace.months} months`
            : 'Everyday, day by day'
        }
      >
        {pace.today >= 0 && (
          <span className="tabular-nums">
            <span className="font-semibold text-foreground">
              {dollars(pace.spent)}
            </span>{' '}
            so far
            {pace.target > 0 && (
              <>
                {' · '}
                <span
                  className={cn(
                    'font-semibold',
                    over ? 'text-over' : 'text-accent',
                  )}
                >
                  {dollars(Math.abs(pace.overPace))} {over ? 'over' : 'under'}
                </span>{' '}
                even pace
              </>
            )}
            {pace.vsUsual !== null && (
              <>
                {' · '}
                <span className="font-semibold text-foreground">
                  {dollars(Math.abs(pace.vsUsual))}{' '}
                  {pace.vsUsual > 0 ? 'above' : 'below'}
                </span>{' '}
                your usual
              </>
            )}
          </span>
        )}
      </PaneHeader>
      <div ref={ref} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={paceSummary(pace)}
          className="block touch-pan-y select-none"
          // A mouse hovers a day; a finger taps one, and taps it again to close.
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse') setHover(dayAt(e))
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setHover(null)
          }}
          onClick={(e) => {
            const day = dayAt(e)
            setHover(hover === day ? null : day)
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-border)"
              />
              <text
                x={PAD.left - 6}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-muted text-[10px] tabular-nums"
              >
                {compactDollars(t)}
              </text>
            </g>
          ))}
          {pace.usual && (
            <>
              <path
                d={
                  pace.usual
                    .map((u, i) => `${i ? 'L' : 'M'}${x(i)},${y(u.high)}`)
                    .join('') +
                  pace.usual
                    .map((_, i, all) => {
                      const j = all.length - 1 - i
                      return `L${x(j)},${y(all[j].low)}`
                    })
                    .join('') +
                  'Z'
                }
                fill="var(--color-muted)"
                opacity={0.14}
              />
              <path
                d={line(pace.usual.map((u) => u.median))}
                fill="none"
                stroke="var(--color-muted)"
                strokeDasharray="3 3"
                opacity={0.7}
              />
            </>
          )}
          {pace.target > 0 && (
            <>
              <line
                x1={x(0)}
                y1={y(0)}
                x2={x(days - 1)}
                y2={y(pace.target)}
                stroke="var(--color-accent)"
                strokeDasharray="6 4"
                opacity={0.8}
              />
              <text
                x={x(days - 1)}
                y={y(pace.target) - 6}
                textAnchor="end"
                className="fill-accent text-[10px] font-semibold"
              >
                Budget {compactDollars(pace.target)}
              </text>
            </>
          )}
          {pace.daily.map((d, i) => {
            if (i > pace.today || d <= 0) return null
            const h = Math.min(40, (d / max) * 160)
            return (
              <rect
                key={i}
                x={x(i) - 2}
                y={bottom - h}
                width={4}
                height={h}
                fill="var(--color-foreground)"
                opacity={0.12}
              />
            )
          })}
          {soFar.length > 0 && (
            <>
              <path
                d={line(soFar)}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
              <circle
                cx={x(pace.today)}
                cy={y(pace.spent)}
                r={4}
                fill={color}
              />
            </>
          )}
          {paydays.map((p) => (
            <g key={p}>
              <line
                x1={x(dayOf(p))}
                x2={x(dayOf(p))}
                y1={PAD.top}
                y2={bottom}
                stroke="var(--color-accent)"
                opacity={0.25}
              />
              <text
                x={x(dayOf(p))}
                y={bottom + 26}
                textAnchor="middle"
                className="fill-accent text-[10px] font-bold"
              >
                $
              </text>
            </g>
          ))}
          {bills.map((o) => (
            <circle
              key={`${o.plan.id}-${o.due}`}
              cx={x(dayOf(o.due))}
              cy={bottom + 8}
              r={3.5}
              fill={o.paidBy ? 'var(--color-planned)' : 'none'}
              stroke="var(--color-planned)"
            />
          ))}
          {[0, 7, 14, 21, days - 1].map((d) => (
            <text
              key={d}
              x={x(d)}
              y={HEIGHT - 2}
              textAnchor={d === 0 ? 'start' : d === days - 1 ? 'end' : 'middle'}
              className="fill-muted text-[10px]"
            >
              {dayLabel(dateOf(d))}
            </text>
          ))}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={bottom}
              stroke="var(--color-foreground)"
              opacity={0.4}
            />
          )}
        </svg>
        {hover !== null && (
          <DayTip
            date={dateOf(hover)}
            left={Math.max(0, Math.min(x(hover) + 8, width - 216))}
            spent={hover <= pace.today ? pace.total[hover] : null}
            usual={pace.usual?.[hover].median ?? null}
            even={pace.target ? (pace.target * (hover + 1)) / days : null}
            view={view}
            bills={bills.filter((o) => o.due === dateOf(hover))}
            payday={paydays.includes(dateOf(hover))}
          />
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted sm:gap-x-4 sm:text-xs">
        <Key
          swatch={<span className="h-0.5 w-4" style={{ background: color }} />}
        >
          This month
        </Key>
        {pace.usual && (
          <Key swatch={<span className="h-2.5 w-4 bg-muted/30" />}>
            Your usual range
          </Key>
        )}
        {pace.target > 0 && (
          <Key
            swatch={
              <span className="w-4 border-t-2 border-dashed border-accent" />
            }
          >
            Even pace to Budget
          </Key>
        )}
        {paydays.length > 0 && <span className="text-accent">$ payday</span>}
        {bills.length > 0 && (
          <span className="text-planned">● bill paid ○ due</span>
        )}
      </div>
    </div>
  )
}

function Key({
  swatch,
  children,
}: {
  swatch: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="inline-flex">
        {swatch}
      </span>
      {children}
    </span>
  )
}

/** The chart in words, for screen readers. */
function paceSummary(p: MonthPace): string {
  if (p.today < 0) return 'This month hasn’t started yet.'
  const parts = [`${dollars(p.spent)} everyday spending so far`]
  if (p.target > 0)
    parts.push(
      `${dollars(Math.abs(p.overPace))} ${p.overPace > 0 ? 'over' : 'under'} the Budget’s even pace`,
    )
  if (p.vsUsual !== null)
    parts.push(
      `${dollars(Math.abs(p.vsUsual))} ${p.vsUsual > 0 ? 'above' : 'below'} your usual by now`,
    )
  return `${parts.join(', ')}.`
}

function DayTip({
  date,
  left,
  spent,
  usual,
  even,
  view,
  bills,
  payday,
}: {
  date: string
  left: number
  spent: number | null
  usual: number | null
  even: number | null
  view: MonthView
  bills: Array<Occurrence>
  payday: boolean
}) {
  const txns = view.everyday
    .flatMap((c) => c.txns)
    .filter((t) => t.date === date)
    .sort((a, b) => b.amount - a.amount)
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 w-52 rounded-lg border border-border bg-surface/95 p-2 text-xs shadow-lg backdrop-blur"
      style={{ left }}
    >
      <p className="font-semibold">{dayLabel(date)}</p>
      <p className="text-muted tabular-nums">
        {[
          spent !== null && `${dollars(spent)} so far`,
          usual !== null && `usual ${dollars(usual)}`,
          even !== null && `even ${dollars(even)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {payday && <p className="text-accent">Payday</p>}
      {bills.map((o) => (
        <p key={o.plan.id} className="text-planned">
          {o.plan.name} {dollars(o.plan.amount)}
          {o.paidBy ? ' · paid' : ' · due'}
        </p>
      ))}
      {txns.slice(0, 4).map((t) => (
        <p key={t.id} className="flex justify-between gap-2 tabular-nums">
          <span className="truncate">{t.store}</span>
          <span>{dollars(t.amount)}</span>
        </p>
      ))}
      {txns.length > 4 && <p className="text-muted">+{txns.length - 4} more</p>}
    </div>
  )
}
