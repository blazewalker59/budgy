/**
 * Each everyday Category against the plan: the outline is its Target, the
 * gray bar what the whole Household spends, and the colored bar the part
 * that comes from the Selection (a person, a card). Hover or tap for the
 * numbers; selecting a Category filters the purchases.
 */

import { barX, defineChart } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS, ChartCard } from './ChartCard'
import type { CategoryShare } from '@/lib/model/breakdown'
import { dollars } from '@/lib/model/money'

const ROW = 22

function describe(c: CategoryShare, selecting: boolean, label: string): string {
  const share = c.total ? Math.round((c.selected / c.total) * 100) : 0
  return [
    c.name,
    selecting
      ? `${label} ${dollars(c.selected)} of ${dollars(c.total)} (${share}%)`
      : `${dollars(c.total)} spent`,
    c.target !== null
      ? `Target ${dollars(c.target)} · ${
          c.total > c.target
            ? `${dollars(c.total - c.target)} over`
            : `${dollars(c.target - c.total)} left`
        }`
      : 'No Target',
    selecting && c.target
      ? `${label} uses ${Math.round((c.selected / c.target) * 100)}% of the Target`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function PlanChart({
  categories,
  selecting,
  label,
  active,
  onSelect,
}: {
  categories: Array<CategoryShare>
  /** A Selection narrows the spending (otherwise colored = everything). */
  selecting: boolean
  /** What the Selection is called in tooltips ("Blaze Apple Card"). */
  label: string
  /** The Category the purchases are filtered to, if any. */
  active: string | null
  onSelect: (category: string) => void
}) {
  const definition = useMemo(() => {
    const short = (name: string) =>
      name.length > 16 ? `${name.slice(0, 15)}…` : name
    return defineChart({
      margin: { left: 112 },
      marks: [
        barX(
          categories.filter((c) => c.target !== null),
          {
            id: 'target',
            y: 'name',
            x1: () => 0,
            x2: (c) => (c.target ?? 0) / 100,
            key: 'name',
            fill: 'transparent',
            stroke: CHART_COLORS.foreground,
            strokeOpacity: 0.55,
            strokeDasharray: '3 2',
            strokeWidth: 1,
            radius: 2,
          },
        ),
        ...(selecting
          ? [
              barX(categories, {
                id: 'total',
                y: 'name',
                x1: () => 0,
                x2: (c) => c.total / 100,
                key: 'name',
                fill: CHART_COLORS.muted,
                fillOpacity: 0.3,
                inset: 3,
                radius: 2,
              }),
            ]
          : []),
        barX(categories, {
          id: 'selected',
          y: 'name',
          x1: () => 0,
          x2: (c) => (selecting ? c.selected : c.total) / 100,
          key: 'name',
          fill: (c) =>
            !selecting && c.target !== null && c.total > c.target
              ? CHART_COLORS.over
              : CHART_COLORS.accent,
          fillOpacity: 0.85,
          inset: 3,
          radius: 2,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: {
            ticks: { count: 4, format: (v: number) => dollars(v * 100) },
          },
        },
        y: {
          scale: () => scaleBand<string>().padding(0.1),
          axis: {
            ticks: {
              format: (name: string) =>
                name === active ? `▸ ${short(name)}` : short(name),
            },
          },
        },
      },
      tooltip: {
        use: tooltip,
        format(point) {
          return describe(point.datum as CategoryShare, selecting, label)
        },
      },
    })
  }, [categories, selecting, label, active])

  return (
    <ChartCard
      legend={[
        ...(selecting
          ? [
              { label, color: CHART_COLORS.accent },
              { label: 'Everyone', color: CHART_COLORS.muted },
            ]
          : [
              { label: 'Spent', color: CHART_COLORS.accent },
              { label: 'Over Target', color: CHART_COLORS.over },
            ]),
        {
          label: 'Target',
          color: CHART_COLORS.foreground,
          shape: 'line' as const,
        },
      ]}
      headline={<span>Tap a category to see its purchases</span>}
    >
      <Chart
        definition={definition}
        height={categories.length * ROW + 28}
        initialWidth={360}
        onSelect={(point) =>
          point && onSelect((point.datum as CategoryShare).name)
        }
        ariaLabel={`Spending by category against Targets${selecting ? `, with ${label}'s part` : ''}`}
      />
    </ChartCard>
  )
}
