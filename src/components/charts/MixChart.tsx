/**
 * Where the money goes, as shares: one 100% bar for the typical month and
 * one for the Targets, split by Category and lined up so a share that the
 * Targets shrink (or grow) is easy to spot. Hover or tap a piece for its
 * numbers.
 */

import { barX, defineChart } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import type { MixSlice } from '@/lib/model/mix'
import { dollars } from '@/lib/model/money'

export interface MixPiece {
  key: string
  row: 'Typical' | 'Targets'
  name: string
  color: string
  x1: number
  x2: number
  share: number
  amount: number
  slice: MixSlice
}

const pct = (share: number) => `${Math.round(share * 100)}%`

export function MixChart({
  slices,
  colors,
}: {
  slices: Array<MixSlice>
  colors: Array<string>
}) {
  const pieces = useMemo(() => {
    const out: Array<MixPiece> = []
    for (const row of ['Typical', 'Targets'] as const) {
      let at = 0
      slices.forEach((s, i) => {
        const share = row === 'Typical' ? s.typicalShare : s.targetShare
        if (share <= 0) return
        out.push({
          key: `${row}-${s.name}`,
          row,
          name: s.name,
          color: colors[i],
          x1: at,
          x2: at + share,
          share,
          amount: row === 'Typical' ? s.typical : s.target,
          slice: s,
        })
        at += share
      })
    }
    return out
  }, [slices, colors])

  const definition = useMemo(
    () =>
      defineChart({
        margin: { top: 0, right: 0, bottom: 0, left: 56 },
        marks: [
          barX(pieces, {
            id: 'shares',
            y: 'row',
            x1: 'x1',
            x2: 'x2',
            key: 'key',
            fill: (p) => p.color,
            stroke: 'var(--color-surface)',
            strokeWidth: 1,
            inset: 0,
          }),
        ],
        scales: {
          x: { scale: () => scaleLinear().domain([0, 1]), axis: false },
          y: {
            scale: () => scaleBand<string>().padding(0.18),
            axis: { ticks: { format: (r: string) => r } },
          },
        },
        tooltip: {
          use: tooltip,
          format(point) {
            const p = point.datum as MixPiece
            const s = p.slice
            return [
              p.name,
              `Typical ${pct(s.typicalShare)} · ${dollars(s.typical)}/mo`,
              `Target ${pct(s.targetShare)} · ${dollars(s.target)}/mo`,
            ].join('\n')
          },
        },
      }),
    [pieces],
  )

  const first = slices[0]
  return (
    <Chart
      definition={definition}
      height={66}
      initialWidth={340}
      ariaLabel={
        first
          ? `${first.name} is ${pct(first.typicalShare)} of a typical month and ${pct(first.targetShare)} of the Targets`
          : 'No spending yet'
      }
    />
  )
}
