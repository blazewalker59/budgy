/**
 * A balance (or net worth) at each month's end, as a line, so growth shows
 * from the first recorded month on. Hover or tap a month.
 */

import { defineChart, lineY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { scalePoint } from '@tanstack/charts/scales/point'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS, ChartCard } from './ChartCard'
import { monthLabel } from '@/lib/model/dates'
import { dollars, signedDollars } from '@/lib/model/money'

export interface WorthPoint {
  month: string
  /** Cents. */
  value: number
}

export function WorthChart({
  points,
  label,
  color = CHART_COLORS.accent,
  height = 170,
}: {
  points: Array<WorthPoint>
  label: string
  color?: string
  height?: number
}) {
  const every = Math.ceil(points.length / 7)
  const first = points[0]
  const last = points[points.length - 1]
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          lineY(points, {
            id: 'worth',
            x: 'month',
            y: (p) => p.value / 100,
            stroke: color,
            strokeWidth: 2,
            points: points.length < 30,
          }),
        ],
        scales: {
          x: {
            scale: () => scalePoint<string>().padding(0.3),
            axis: {
              ticks: {
                format: (m: string) => {
                  const i = points.findIndex((x) => x.month === m)
                  if ((points.length - 1 - i) % every !== 0) return ''
                  const l = monthLabel(m)
                  return l.startsWith('Jan') || i === 0
                    ? `${l.slice(0, 3)} ’${l.slice(-2)}`
                    : l.slice(0, 3)
                },
              },
            },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              ticks: { count: 4, format: (v: number) => dollars(v * 100) },
            },
          },
        },
        tooltip: {
          use: tooltip,
          format(point) {
            const p = point.datum as WorthPoint
            return `${monthLabel(p.month, true)}\n${dollars(p.value)}`
          },
        },
      }),
    [points, color, every],
  )
  return (
    <ChartCard
      headline={
        first &&
        last &&
        points.length > 1 && (
          <span className="tabular-nums">
            {signedDollars(last.value - first.value)} since{' '}
            {monthLabel(first.month)}
          </span>
        )
      }
      legend={[{ label, color, shape: 'line' }]}
    >
      <Chart
        definition={definition}
        height={height}
        initialWidth={360}
        ariaLabel={`${label} by month${last ? `, ${dollars(last.value)} now` : ''}`}
      />
    </ChartCard>
  )
}
