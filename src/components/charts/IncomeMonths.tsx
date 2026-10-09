/**
 * Each month's pay (as entered: a month with a third paycheck shows it)
 * against everything spent: what was left over (or
 * how far spending ran past what came in). Hover or tap a bar.
 */

import { barY, defineChart, ruleY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS, ChartCard } from './ChartCard'
import { monthLabel } from '@/lib/model/dates'
import { dollars, signedDollars } from '@/lib/model/money'

export interface IncomeMonth {
  month: string
  /** Cents. */
  received: number
  spent: number
}

export function IncomeMonths({
  months,
  typicalLeft,
}: {
  months: Array<IncomeMonth>
  /** Typical take-home minus typical spending, per month. */
  typicalLeft: number
}) {
  const every = Math.ceil(months.length / 8)
  const definition = useMemo(
    () =>
      defineChart({
        marks: [
          barY(months, {
            id: 'left',
            x: 'month',
            y1: () => 0,
            y2: (m) => (m.received - m.spent) / 100,
            key: 'month',
            fill: (m) =>
              m.received >= m.spent ? CHART_COLORS.accent : CHART_COLORS.over,
            fillOpacity: 0.85,
            radius: 2,
          }),
          ruleY([0], { id: 'zero', stroke: CHART_COLORS.muted }),
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
            const m = point.datum as IncomeMonth
            return [
              monthLabel(m.month, true),
              `${dollars(m.received)} pay`,
              `${dollars(m.spent)} spent`,
              `${signedDollars(m.received - m.spent)} left`,
            ].join('\n')
          },
        },
      }),
    [months, every],
  )
  return (
    <ChartCard
      legend={[
        { label: 'Left over', color: CHART_COLORS.accent },
        { label: 'Spent more than pay', color: CHART_COLORS.over },
      ]}
      headline={
        <span className="tabular-nums">
          Typical{' '}
          <span className="font-semibold text-foreground">
            {signedDollars(typicalLeft)}
          </span>
          /mo
        </span>
      }
    >
      <Chart
        definition={definition}
        height={170}
        initialWidth={360}
        ariaLabel={`Money left over each month for ${months.length} months`}
      />
    </ChartCard>
  )
}
