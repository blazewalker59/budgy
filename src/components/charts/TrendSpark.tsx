/**
 * A Category's last months as tiny bars, newest on the right, with the
 * Target as a dashed line: a trend at a glance. Decorative (no axes, no
 * pointer); the row around it opens the full chart.
 */

import { barY, defineChart, ruleY } from '@tanstack/charts'
import { Chart } from '@tanstack/charts/react'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import { useMemo } from 'react'
import { CHART_COLORS } from './ChartCard'

interface Bar {
  key: string
  value: number
  strong: boolean
  over: boolean
}

export function TrendSpark({
  values,
  target,
  highlight = values.length,
}: {
  values: Array<number>
  target?: number | null
  /** How many of the newest bars to draw strong (the averaged months). */
  highlight?: number
}) {
  const bars = useMemo(
    () =>
      values.map((v, i): Bar => ({
        key: String(i),
        value: Math.max(v, 0),
        strong: i >= values.length - highlight,
        over: target != null && v > target,
      })),
    [values, highlight, target],
  )
  const definition = useMemo(
    () =>
      defineChart({
        guides: false,
        margin: 0,
        pointer: false,
        keyboard: false,
        tooltip: false,
        marks: [
          barY(bars, {
            id: 'months',
            x: 'key',
            y: 'value',
            key: 'key',
            fill: (b) =>
              !b.strong
                ? CHART_COLORS.muted
                : b.over
                  ? CHART_COLORS.over
                  : CHART_COLORS.accent,
            fillOpacity: 0.9,
            radius: 1,
          }),
          ...(target
            ? [
                ruleY([target], {
                  id: 'target',
                  stroke: CHART_COLORS.foreground,
                  strokeOpacity: 0.6,
                  strokeDasharray: '2 2',
                }),
              ]
            : []),
        ],
        scales: {
          x: { scale: () => scaleBand<string>().padding(0.2) },
          y: { scale: scaleLinear },
        },
      }),
    [bars, target],
  )
  return (
    <Chart
      definition={definition}
      height={20}
      initialWidth={72}
      ariaLabel="Monthly trend"
    />
  )
}
