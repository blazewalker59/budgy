/**
 * Take-home pay, spent: one bar for the typical month and one for the
 * Budget, each split into everyday spending, housing and planned bills,
 * with what's left over after them. The dashed line is all of take-home
 * pay, so a bar past it spends more than comes in. Hover or tap a piece.
 */

import { barX, defineChart, ruleX } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { tooltip } from '@tanstack/charts/tooltip'
import { useMemo } from 'react'
import { CHART_COLORS } from './ChartCard'
import type { IncomeSplit, SplitPart } from '@/lib/model/pay'
import { SPLIT_COLORS, SPLIT_LABELS } from '@/lib/format'
import { dollars } from '@/lib/model/money'

export type IncomeRow = 'Typical' | 'Budget'

interface Piece {
  key: string
  row: IncomeRow
  part: SplitPart | 'left'
  x1: number
  x2: number
  amount: number
}

const pct = (share: number) => `${Math.round(share * 100)}%`

export function IncomeChart({
  income,
  rows,
}: {
  income: number
  rows: Record<IncomeRow, IncomeSplit>
}) {
  const pieces = useMemo(() => {
    const out: Array<Piece> = []
    for (const row of ['Typical', 'Budget'] as const) {
      let at = 0
      for (const p of rows[row].parts) {
        if (p.share <= 0) continue
        out.push({
          key: `${row}-${p.part}`,
          row,
          part: p.part,
          x1: at,
          x2: at + p.share,
          amount: p.amount,
        })
        at += p.share
      }
      if (at < 1)
        out.push({
          key: `${row}-left`,
          row,
          part: 'left',
          x1: at,
          x2: 1,
          amount: rows[row].left,
        })
    }
    return out
  }, [rows])
  const max = Math.max(1, rows.Typical.spentShare, rows.Budget.spentShare)

  const definition = useMemo(
    () =>
      defineChart({
        margin: { top: 0, right: 2, bottom: 0, left: 56 },
        marks: [
          barX(pieces, {
            id: 'split',
            y: 'row',
            x1: 'x1',
            x2: 'x2',
            key: 'key',
            fill: (p) => SPLIT_COLORS[p.part],
            stroke: 'var(--color-surface)',
            strokeWidth: 1,
            inset: 0,
          }),
          ruleX([1], {
            id: 'take-home',
            stroke: CHART_COLORS.foreground,
            strokeOpacity: 0.6,
            strokeDasharray: '3 2',
          }),
        ],
        scales: {
          x: { scale: () => scaleLinear().domain([0, max]), axis: false },
          y: {
            scale: () => scaleBand<string>().padding(0.18),
            axis: { ticks: { format: (r: string) => r } },
          },
        },
        tooltip: {
          use: tooltip,
          format(point) {
            const p = point.datum as Piece
            return [
              `${p.row}: ${SPLIT_LABELS[p.part]}`,
              `${dollars(p.amount)}/mo · ${pct(p.x2 - p.x1)} of take-home`,
            ].join('\n')
          },
        },
      }),
    [pieces, max],
  )

  return (
    <Chart
      definition={definition}
      height={66}
      initialWidth={340}
      ariaLabel={`Share of ${dollars(income)} take-home spent. Typical month: ${pct(rows.Typical.spentShare)}. Budget: ${pct(rows.Budget.spentShare)}.`}
    />
  )
}
