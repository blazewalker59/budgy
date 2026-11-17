/**
 * Everyday spending as two rings: Need, Nice and Fluff outside, each one's
 * Categories inside, lined up beneath them. The slice in view (hovered or
 * opened) stays bright and the rest dim. Its owner draws the total in the
 * middle and the list beside it.
 */

import { defineChart } from '@tanstack/charts'
import { pie, polar, radialArc } from '@tanstack/charts/polar'
import { Chart } from '@tanstack/charts/react'
import { useMemo } from 'react'
import type { Rings } from '@/lib/model/rings'
import { TAG_LABELS } from '@/lib/model/types'
import { dollars } from '@/lib/model/money'
import { TAG_FILL } from '@/lib/format'

/** Between neighbouring slices, radians. */
const PAD = 0.014

/** A color, dimmed when another slice is in view. */
const dim = (color: string, lit: boolean) =>
  lit ? color : `color-mix(in oklab, ${color} 30%, transparent)`

export function SpendingDonut({
  rings,
  colors,
  focus,
  size,
  onHover,
  onOpen,
}: {
  rings: Rings
  /** Each inner slice's color, by its name. */
  colors: ReadonlyMap<string, string>
  /** The slice in view, by name; null for none. */
  focus: string | null
  size: number
  onHover: (name: string | null) => void
  onOpen: (name: string) => void
}) {
  const definition = useMemo(() => {
    const focusTag = rings.slices.find((s) => s.name === focus)?.tag ?? null
    const tags = pie(rings.tags, { value: 'value' })
    const slices = pie(rings.slices, { value: 'value' })
    return defineChart(
      {
        marks: [
          polar({
            // Angles come from `pie`; the rings need no scales of their own.
            scales: { angle: null, radius: null },
            marks: [
              radialArc(tags, {
                id: 'tags',
                key: 'tag',
                innerRadius: ({ radius }) => radius * 0.93,
                padAngle: () => PAD,
                fill: (t) =>
                  dim(TAG_FILL[t.tag], !focusTag || focusTag === t.tag),
              }),
              radialArc(slices, {
                id: 'categories',
                key: 'name',
                innerRadius: ({ radius }) => radius * 0.56,
                outerRadius: ({ radius }) => radius * 0.89,
                padAngle: () => PAD,
                fill: (s) =>
                  dim(colors.get(s.name) ?? 'gray', !focus || focus === s.name),
              }),
            ],
          }),
        ],
        scales: { x: null, y: null },
        margin: 0,
      },
      // No focus dot: the slice in view brightens and the rest dim instead.
      { keyboard: true, tooltip: false, focusRing: false },
    )
  }, [rings, colors, focus])

  // The datum under the pointer: a Category slice, or a tag on the outside.
  const sliceName = (datum: unknown) =>
    datum && typeof datum === 'object' && 'name' in datum
      ? String((datum as { name: string }).name)
      : null

  return (
    <Chart
      definition={definition}
      width={size}
      height={size}
      ariaLabel={`${dollars(rings.total)} everyday: ${rings.tags
        .map(
          (t) =>
            `${TAG_LABELS[t.tag]} ${Math.round((t.value / rings.total) * 100)}%`,
        )
        .join(', ')}.`}
      onFocusChange={(point) => onHover(sliceName(point?.datum))}
      onSelect={(point) => {
        const name = sliceName(point?.datum)
        if (name) onOpen(name)
      }}
    />
  )
}
