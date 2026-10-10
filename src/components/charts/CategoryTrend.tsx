/**
 * One Category month by month: everyday spending as bars, Planned Expense
 * payments stacked on top in the planned color, and the Target as a dashed
 * line. Hover or tap a bar for that month.
 */

import { barY, defineChart, ruleY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS, ChartCard } from './ChartCard'
import { monthLabel } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'

export interface TrendMonth {
  month: string
  /** Cents. */
  everyday: number
  planned: number
}

export function CategoryTrend({
  months,
  target,
  typical,
}: {
  months: Array<TrendMonth>
  target: number | null
  typical: number
}) {
  const every = Math.ceil(months.length / 8)
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(months, {
            id: 'everyday',
            x: 'month',
            y1: () => 0,
            y2: (m) => Math.max(m.everyday, 0) / 100,
            key: 'month',
            fill: (m) =>
              target !== null && m.everyday > target
                ? CHART_COLORS.over
                : CHART_COLORS.accent,
            fillOpacity: 0.85,
            radius: 2,
          }),
          barY(
            months.filter((m) => m.planned > 0),
            {
              id: 'planned',
              x: 'month',
              y1: (m) => Math.max(m.everyday, 0) / 100,
              y2: (m) => (Math.max(m.everyday, 0) + m.planned) / 100,
              key: 'month',
              fill: CHART_COLORS.planned,
              fillOpacity: 0.85,
              radius: 2,
            },
          ),
          ...(target !== null
            ? [
                ruleY([target / 100], {
                  id: 'target',
                  stroke: CHART_COLORS.foreground,
                  strokeOpacity: 0.6,
                  strokeDasharray: '4 3',
                }),
              ]
            : []),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().padding(0.25),
            axis: {
              ticks: {
                format: (m: string) => {
                  const i = months.findIndex((x) => x.month === m)
                  if ((months.length - 1 - i) % every !== 0) return ''
                  const label = monthLabel(m)
                  return label.startsWith('Jan') || i === 0
                    ? `${label.slice(0, 3)} ’${label.slice(-2)}`
                    : label.slice(0, 3)
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
            const m = point.datum as TrendMonth
            return [
              monthLabel(m.month, true),
              `${dollars(m.everyday)} everyday`,
              m.planned ? `${dollars(m.planned)} planned bills` : '',
              target !== null
                ? m.everyday > target
                  ? `${dollars(m.everyday - target)} over Target`
                  : `${dollars(target - m.everyday)} under Target`
                : '',
            ]
              .filter(Boolean)
              .join('\n')
          },
        },
      }),
    [months, target, every],
  )
  return (
    <ChartCard
      legend={[
        { label: 'Everyday', color: CHART_COLORS.accent },
        { label: 'Over Target', color: CHART_COLORS.over },
        ...(months.some((m) => m.planned > 0)
          ? [{ label: 'Planned bills', color: CHART_COLORS.planned }]
          : []),
        ...(target !== null
          ? [
              {
                label: 'Target',
                color: CHART_COLORS.foreground,
                shape: 'line' as const,
              },
            ]
          : []),
      ]}
      headline={
        <span className="tabular-nums">
          Typical{' '}
          <span className="font-semibold text-foreground">
            {dollars(typical)}
          </span>
          {target !== null && (
            <>
              {' '}
              · Target{' '}
              <span className="font-semibold text-foreground">
                {dollars(target)}
              </span>
            </>
          )}
        </span>
      }
    >
      <Chart
        definition={definition}
        height={190}
        initialWidth={360}
        ariaLabel={`Monthly spending over ${months.length} months. Typical ${dollars(typical)}.`}
      />
    </ChartCard>
  )
}
