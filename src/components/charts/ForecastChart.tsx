/**
 * The months ahead: everyday Targets as bars with planned bills stacked on
 * top, so a heavy month stands out before it arrives. Hover or tap a month
 * for what's in it; selecting one lists its bills below.
 */

import { barY, defineChart } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS, ChartCard } from './ChartCard'
import type { ForecastMonth } from '@/lib/model/forecast'
import { dayLabel, monthLabel } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'

export function ForecastChart({
  months,
  onSelect,
}: {
  months: Array<ForecastMonth>
  onSelect: (month: string | null) => void
}) {
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(months, {
            id: 'everyday',
            x: 'month',
            y1: () => 0,
            y2: (m) => m.everyday / 100,
            key: 'month',
            fill: CHART_COLORS.accent,
            fillOpacity: 0.7,
            radius: 2,
          }),
          barY(
            months.filter((m) => m.planned > 0),
            {
              id: 'planned',
              x: 'month',
              y1: (m) => m.everyday / 100,
              y2: (m) => (m.everyday + m.planned) / 100,
              key: 'month',
              fill: CHART_COLORS.planned,
              fillOpacity: 0.9,
              radius: 2,
            },
          ),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().padding(0.2),
            axis: {
              ticks: { format: (m: string) => monthLabel(m).slice(0, 3) },
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
            const m = point.datum as ForecastMonth
            return [
              monthLabel(m.month, true),
              `${dollars(m.everyday)} everyday Targets`,
              ...m.occurrences.map(
                (o) =>
                  `${o.plan.name} ${dollars(o.paidBy ? o.paidBy.amount : o.plan.amount)} · ${dayLabel(o.due)}`,
              ),
              `Total ${dollars(m.everyday + m.planned)}`,
            ].join('\n')
          },
        },
      }),
    [months],
  )
  const planned = months.reduce((n, m) => n + m.planned, 0)
  return (
    <ChartCard
      legend={[
        { label: 'Everyday Targets', color: CHART_COLORS.accent },
        { label: 'Planned bills', color: CHART_COLORS.planned },
      ]}
      headline={
        <span className="tabular-nums">
          Planned{' '}
          <span className="font-semibold text-foreground">
            {dollars(planned)}
          </span>{' '}
          this year
        </span>
      }
    >
      <Chart
        definition={definition}
        height={170}
        initialWidth={360}
        onSelect={(point) =>
          onSelect(point ? (point.datum as ForecastMonth).month : null)
        }
        ariaLabel={`Next ${months.length} months of everyday Targets and planned bills; ${dollars(planned)} planned`}
      />
    </ChartCard>
  )
}
