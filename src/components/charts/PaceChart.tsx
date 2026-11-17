/**
 * Pace: this month's everyday spending adding up day by day (red once it's
 * past the Budget's even pace), over the range earlier months had spent by
 * each day, with paydays as rules and planned bills as dots along the
 * bottom. Hover or tap a day for its running total and biggest purchases.
 */

import {
  areaY,
  defineChart,
  dot,
  lineY,
  rect,
  ruleX,
  whenFocused,
} from '@tanstack/charts'
import { decorative } from '@tanstack/charts/mark/decorative'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS, ChartCard } from './ChartCard'
import type { MonthPace } from '@/lib/model/pace'
import type { MonthView } from '@/lib/model/month'
import type { Occurrence } from '@/lib/model/plans'
import { dayLabel } from '@/lib/model/dates'
import { compactDollars, dollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'

/** One day of the month, for the tooltip and the focus. */
interface PaceDay {
  day: number
  date: string
  /** Spent by this day; null after today. */
  spent: number | null
  usual: number | null
  even: number
  /** Where the focus sits: the line in view on this day. */
  y: number
}

export function PaceChart({
  pace,
  view,
  paydays,
  bills,
  bare,
}: {
  pace: MonthPace
  view: MonthView
  /** Paydays in the month. */
  paydays: Array<string>
  /** Planned bills due in the month. */
  bills: Array<Occurrence>
  bare?: boolean
}) {
  const days = pace.daily.length
  const over = pace.overPace > 0
  const line = over ? CHART_COLORS.over : CHART_COLORS.accent
  const definition = useMemo(() => {
    const dateOf = (day: number) =>
      `${view.month}-${String(day).padStart(2, '0')}`
    const dayOf = (date: string) => Number(date.slice(8, 10))
    const rows: Array<PaceDay> = pace.daily.map((_, i) => {
      const spent = i <= pace.today ? pace.total[i] : null
      const usual = pace.usual?.[i].median ?? null
      const even = (pace.target * (i + 1)) / days
      return {
        day: i + 1,
        date: dateOf(i + 1),
        spent,
        usual,
        even,
        y: spent ?? usual ?? even,
      }
    })
    const txns = view.everyday.flatMap((c) => c.txns)
    const usual = pace.usual?.map((u, i) => ({ day: i + 1, ...u })) ?? []
    return defineChart(
      {
        marks: [
          decorative(
            areaY(usual, {
              id: 'usual-range',
              x: 'day',
              y1: 'low',
              y2: 'high',
              fill: CHART_COLORS.muted,
              fillOpacity: 0.14,
            }),
          ),
          decorative(
            lineY(usual, {
              id: 'usual',
              x: 'day',
              y: 'median',
              stroke: CHART_COLORS.muted,
              strokeOpacity: 0.7,
              strokeDasharray: '3 3',
            }),
          ),
          ...(pace.target > 0
            ? [
                decorative(
                  lineY(
                    [
                      { day: 1, y: pace.target / days },
                      { day: days, y: pace.target },
                    ],
                    {
                      id: 'even-pace',
                      x: 'day',
                      y: 'y',
                      stroke: CHART_COLORS.accent,
                      strokeOpacity: 0.8,
                      strokeDasharray: '6 4',
                    },
                  ),
                ),
              ]
            : []),
          decorative(
            ruleX(paydays.map(dayOf), {
              id: 'paydays',
              stroke: CHART_COLORS.accent,
              strokeOpacity: 0.3,
            }),
          ),
          decorative(
            rect(
              pace.daily
                .map((amount, i) => ({ day: i + 1, amount }))
                .filter((d) => d.day - 1 <= pace.today && d.amount > 0),
              {
                id: 'daily',
                x1: (d) => d.day - 0.3,
                x2: (d) => d.day + 0.3,
                y1: () => 0,
                y2: 'amount',
                fill: CHART_COLORS.foreground,
                fillOpacity: 0.14,
              },
            ),
          ),
          decorative(
            lineY(
              rows.filter((r) => r.spent !== null),
              {
                id: 'this-month',
                x: 'day',
                y: 'spent',
                stroke: line,
                strokeWidth: 2.5,
              },
            ),
          ),
          // Bills along the bottom: filled once paid, ringed while due.
          ...[true, false].map((paid) =>
            decorative(
              dot(
                bills.filter((o) => !!o.paidBy === paid),
                {
                  id: paid ? 'bills-paid' : 'bills-due',
                  x: (o) => dayOf(o.due),
                  y: () => 0,
                  r: 3.5,
                  fill: paid ? CHART_COLORS.planned : CHART_COLORS.surface,
                  stroke: CHART_COLORS.planned,
                  strokeWidth: 1.5,
                },
              ),
            ),
          ),
          whenFocused(
            ruleX(rows, {
              id: 'focus-day',
              x: 'day',
              stroke: CHART_COLORS.foreground,
              strokeOpacity: 0.35,
            }),
            { match: 'x' },
          ),
          // The days themselves: what the pointer and keyboard land on.
          dot(rows, {
            id: 'days',
            x: 'day',
            y: 'y',
            key: 'date',
            r: (r) => (r.day - 1 === pace.today ? 4 : 0),
            fill: line,
          }),
        ],
        scales: {
          x: {
            scale: () => scaleLinear().domain([1, days]),
            axis: {
              ticks: {
                values: [1, 8, 15, 22, days],
                format: (d: number) => dayLabel(dateOf(d)),
              },
            },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              ticks: { count: 4, format: (v: number) => compactDollars(v) },
            },
          },
        },
      },
      {
        focus: 'nearest-x',
        tooltip: {
          use: tooltip,
          content: (points) => {
            const r = points[0]?.datum as PaceDay | undefined
            if (!r) return { rows: [] }
            const spentToday = txns
              .filter((t) => t.date === r.date)
              .sort((a, b) => b.amount - a.amount)
            return {
              title: dayLabel(r.date),
              rows: [
                ...(r.spent !== null
                  ? [{ label: 'So far', value: dollars(r.spent), color: line }]
                  : []),
                ...(r.usual !== null
                  ? [{ label: 'Usual', value: dollars(r.usual) }]
                  : []),
                ...(pace.target > 0
                  ? [{ label: 'Even pace', value: dollars(r.even) }]
                  : []),
                ...(paydays.includes(r.date)
                  ? [{ label: 'Payday', value: '', color: CHART_COLORS.accent }]
                  : []),
                ...bills
                  .filter((o) => o.due === r.date)
                  .map((o) => ({
                    label: o.plan.name,
                    value: `${dollars(o.plan.amount)} ${o.paidBy ? 'paid' : 'due'}`,
                    color: CHART_COLORS.planned,
                  })),
                ...spentToday.slice(0, 4).map((t) => ({
                  label: t.store,
                  value: dollars(t.amount),
                })),
                ...(spentToday.length > 4
                  ? [{ label: `+${spentToday.length - 4} more`, value: '' }]
                  : []),
              ],
            }
          },
        },
      },
    )
  }, [pace, view, paydays, bills, days, line])

  return (
    <ChartCard
      bare={bare}
      caption={
        pace.months
          ? `Everyday, against your last ${pace.months} months`
          : 'Everyday, day by day'
      }
      headline={
        pace.today >= 0 && (
          <>
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
          </>
        )
      }
      footer={
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <Key color={line} shape="line">
            This month
          </Key>
          {pace.usual && <Key color={CHART_COLORS.muted}>Your usual range</Key>}
          {pace.target > 0 && (
            <Key color={CHART_COLORS.accent} shape="dash">
              Even pace to Budget
            </Key>
          )}
          {paydays.length > 0 && (
            <Key color={CHART_COLORS.accent} shape="rule">
              Payday
            </Key>
          )}
          {bills.length > 0 && (
            <span className="text-planned">● bill paid ○ due</span>
          )}
        </span>
      }
    >
      <Chart
        definition={definition}
        height={220}
        initialWidth={360}
        ariaLabel={paceSummary(pace)}
      />
    </ChartCard>
  )
}

function Key({
  color,
  shape = 'box',
  children,
}: {
  color: string
  shape?: 'box' | 'line' | 'dash' | 'rule'
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={cn(
          'inline-block',
          shape === 'box' && 'h-2.5 w-3 rounded-sm opacity-40',
          shape === 'line' && 'h-0.5 w-3',
          shape === 'dash' && 'w-3 border-t-2 border-dashed',
          shape === 'rule' && 'h-3 w-px opacity-60',
        )}
        style={
          shape === 'dash' ? { borderColor: color } : { background: color }
        }
      />
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
