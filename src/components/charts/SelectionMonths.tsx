/**
 * The Selection month by month, its bars inside everyone's, with the whole
 * everyday plan as a dashed line.
 */

import { barY, defineChart, ruleY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS, ChartCard } from './ChartCard'
import type { MonthShare } from '@/lib/model/breakdown'
import { monthLabel } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'

export function SelectionMonths({
  months,
  target,
  selecting,
  label,
}: {
  months: Array<MonthShare>
  /** All everyday Targets for a month. */
  target: number
  selecting: boolean
  label: string
}) {
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(months, {
            id: 'total',
            x: 'month',
            y1: () => 0,
            y2: (m) => m.total / 100,
            key: 'month',
            fill: selecting ? CHART_COLORS.muted : CHART_COLORS.accent,
            fillOpacity: selecting ? 0.3 : 0.8,
            radius: 2,
          }),
          ...(selecting
            ? [
                barY(months, {
                  id: 'selected',
                  x: 'month',
                  y1: () => 0,
                  y2: (m) => m.selected / 100,
                  key: 'month',
                  fill: CHART_COLORS.accent,
                  fillOpacity: 0.9,
                  inset: 3,
                  radius: 2,
                }),
              ]
            : []),
          ...(target
            ? [
                ruleY([target / 100], {
                  id: 'plan',
                  stroke: CHART_COLORS.foreground,
                  strokeOpacity: 0.55,
                  strokeDasharray: '4 3',
                }),
              ]
            : []),
        ],
        scales: {
          x: {
            scale: () => scaleBand<string>().padding(0.25),
            axis: {
              ticks: { format: (m: string) => monthLabel(m).slice(0, 3) },
            },
          },
          y: {
            scale: scaleLinear,
            nice: true,
            grid: true,
            axis: {
              ticks: { count: 3, format: (v: number) => dollars(v * 100) },
            },
          },
        },
        tooltip: {
          use: tooltip,
          format(point) {
            const m = point.datum as MonthShare
            return [
              monthLabel(m.month, true),
              selecting
                ? `${label} ${dollars(m.selected)} of ${dollars(m.total)}`
                : `${dollars(m.total)} everyday`,
              target ? `Plan ${dollars(target)}` : '',
            ]
              .filter(Boolean)
              .join('\n')
          },
        },
      }),
    [months, target, selecting, label],
  )
  return (
    <ChartCard
      legend={[
        ...(selecting
          ? [
              { label, color: CHART_COLORS.accent },
              { label: 'Everyone', color: CHART_COLORS.muted },
            ]
          : [{ label: 'Everyday', color: CHART_COLORS.accent }]),
        ...(target
          ? [
              {
                label: 'Plan',
                color: CHART_COLORS.foreground,
                shape: 'line' as const,
              },
            ]
          : []),
      ]}
    >
      <Chart
        definition={definition}
        height={130}
        initialWidth={360}
        ariaLabel={`Everyday spending by month${selecting ? ` with ${label}'s part` : ''}`}
      />
    </ChartCard>
  )
}
