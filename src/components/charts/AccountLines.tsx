/**
 * Accounts over time as change: each series a line from zero on the first
 * day, its total in bold on top. Hover or tap a day for every balance and
 * change on it. Its owner (accounts/AccountsChart) draws the key.
 */

import {
  defineChart,
  dot,
  lineY,
  ruleX,
  ruleY,
  whenFocused,
} from '@tanstack/charts'
import { decorative } from '@tanstack/charts/mark/decorative'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS } from './ChartCard'
import { compactDollars, dollars, signedDollars } from '@/lib/model/money'

export interface LineSeries {
  key: string
  name: string
  color: string
  /** Toward net worth at each date. */
  balances: Array<number>
  /** Since the first date. */
  change: Array<number>
}

interface Point {
  key: string
  i: number
  change: number
}

export function AccountLines({
  dates,
  series,
  total,
  label,
}: {
  dates: Array<string>
  series: Array<LineSeries>
  /** The bold line: what the series add up to. */
  total: LineSeries
  /** Each date as the axis and tooltip say it. */
  label: (date: string) => string
}) {
  const last = dates.length - 1
  const definition = useMemo(() => {
    const points = series.flatMap((s) =>
      s.change.map((change, i): Point => ({ key: s.key, i, change })),
    )
    const days = total.change.map((change, i) => ({ i, change }))
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * last))
    return defineChart(
      {
        marks: [
          decorative(
            ruleY([0], {
              id: 'zero',
              stroke: CHART_COLORS.foreground,
              strokeOpacity: 0.25,
            }),
          ),
          decorative(
            lineY(points, {
              id: 'series',
              x: 'i',
              y: 'change',
              z: 'key',
              color: 'key',
              strokeWidth: 1.75,
            }),
          ),
          decorative(
            lineY(days, {
              id: 'total',
              x: 'i',
              y: 'change',
              stroke: CHART_COLORS.foreground,
              strokeWidth: 2.5,
            }),
          ),
          whenFocused(
            ruleX(days, {
              id: 'focus-day',
              x: 'i',
              stroke: CHART_COLORS.foreground,
              strokeOpacity: 0.35,
            }),
            { match: 'x' },
          ),
          // The days themselves: what the pointer and keyboard land on.
          dot(days, { id: 'days', x: 'i', y: 'change', key: 'i', r: 0 }),
        ],
        scales: {
          x: {
            scale: () => scaleLinear().domain([0, Math.max(1, last)]),
            axis: {
              ticks: {
                values: ticks,
                format: (i: number) => label(dates[Math.round(i)]),
              },
            },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              ticks: {
                count: 4,
                format: (v: number) =>
                  `${v > 0 ? '+' : ''}${compactDollars(v)}`,
              },
            },
          },
        },
        color: {
          domain: series.map((s) => s.key),
          range: series.map((s) => s.color),
        },
      },
      {
        focus: 'nearest-x',
        tooltip: {
          use: tooltip,
          content: (focused) => {
            const d = focused[0]?.datum as { i: number } | undefined
            if (!d) return { rows: [] }
            const row = (s: LineSeries, color?: string) => ({
              label: s.name,
              value: `${dollars(s.balances[d.i])} · ${signedDollars(s.change[d.i])}`,
              color,
            })
            return {
              title: label(dates[d.i]),
              rows: [
                { ...row(total), active: true },
                ...series.map((s) => row(s, s.color)),
              ],
            }
          },
        },
      },
    )
  }, [dates, series, total, label, last])

  return (
    <Chart
      definition={definition}
      height={220}
      initialWidth={360}
      ariaLabel={`Since ${label(dates[0])}: ${total.name} ${signedDollars(total.change[last])}, ${series
        .map((s) => `${s.name} ${signedDollars(s.change[last])}`)
        .join(', ')}.`}
    />
  )
}
