/**
 * Where the spending comes from: each card or account, colored by whose it
 * is. Selected sources are solid, the rest faded. Tap one to select it.
 */

import { barX, defineChart } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { ChartCard } from './ChartCard'
import type { SourceShare } from '@/lib/model/breakdown'
import { dollars } from '@/lib/model/money'
import { ownerColor } from '@/lib/format'

export function SourceChart({
  sources,
  perMonth,
  onSelect,
}: {
  sources: Array<SourceShare>
  perMonth: boolean
  onSelect: (account: string) => void
}) {
  const total = sources.reduce((a, s) => a + s.amount, 0)
  const definition = useMemo(() => {
    const short = (name: string) =>
      name.length > 18 ? `${name.slice(0, 17)}…` : name
    return defineChart({
      margin: { left: 124 },
      marks: [
        barX(sources, {
          id: 'sources',
          y: 'account',
          x1: () => 0,
          x2: (s) => s.amount / 100,
          key: 'account',
          // Unselected sources fade (a hex color with alpha).
          fill: (s) => `${ownerColor(s.owner)}${s.selected ? 'e6' : '40'}`,
          inset: 2,
          radius: 2,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: {
            ticks: { count: 3, format: (v: number) => dollars(v * 100) },
          },
        },
        y: {
          scale: () => scaleBand<string>().padding(0.1),
          axis: { ticks: { format: (a: string) => short(a) } },
        },
      },
      tooltip: {
        use: tooltip,
        format(point) {
          const s = point.datum as SourceShare
          return [
            s.account,
            `${s.owner} · ${dollars(s.amount)}${perMonth ? '/mo' : ''}`,
            `${total ? Math.round((s.amount / total) * 100) : 0}% of everyday spending`,
          ].join('\n')
        },
      },
    })
  }, [sources, perMonth, total])

  return (
    <ChartCard
      legend={[...new Set(sources.map((s) => s.owner))].map((o) => ({
        label: o,
        color: ownerColor(o),
      }))}
      headline={<span>Tap an account to filter</span>}
    >
      <Chart
        definition={definition}
        height={sources.length * 24 + 28}
        initialWidth={360}
        onSelect={(point) =>
          point && onSelect((point.datum as SourceShare).account)
        }
        ariaLabel="Everyday spending by card and account"
      />
    </ChartCard>
  )
}
