/**
 * Flow: where the month's money went, as streams from take-home into
 * Housing, planned bills, everyday and what's left, then everyday into
 * Need, Nice and Fluff and their biggest Categories. Hover a stream or a
 * bar to follow it.
 */

import { useMemo, useState } from 'react'
import { PaneHeader } from './PaneHeader'
import type { FlowKind, MoneyNode } from '@/lib/model/flow'
import type { MonthView } from '@/lib/model/month'
import { monthFlow } from '@/lib/model/flow'
import { layoutSankey, spreadLabels } from '@/lib/layout/sankey'
import { compactDollars, dollars } from '@/lib/model/money'
import { TAGS, TAG_LABELS } from '@/lib/model/types'
import { TAG_FILL } from '@/lib/format'
import { useWidth } from '@/components/shared/useWidth'

const HEIGHT = 360
const NODE_WIDTH = 10
/** Narrower than this, Flow skips its tag column: the colors carry the tags. */
const NARROW = 520
/** Longest name a narrow chart's last column has room for. */
const NARROW_LABEL = 13

const COLOR: Record<FlowKind, string> = {
  pay: 'var(--color-accent)',
  left: 'var(--color-accent)',
  beyond: 'var(--color-over)',
  housing: 'var(--color-need)',
  planned: 'var(--color-planned)',
  everyday: 'var(--color-foreground)',
  rest: 'var(--color-muted)',
  ...TAG_FILL,
}

export function FlowChart({
  view,
  takeHome,
}: {
  view: MonthView
  /** Take-home landing this month; null under a Lens. */
  takeHome: number | null
}) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<string | null>(null)
  const narrow = width < NARROW
  const flow = useMemo(
    () => monthFlow(view, takeHome, { compact: narrow }),
    [view, takeHome, narrow],
  )
  // Room right of the last column for its labels; narrow ones take two lines.
  const labelWidth = narrow ? 92 : Math.min(150, width * 0.22)
  const shorten = (label: string) =>
    narrow && label.length > NARROW_LABEL
      ? `${label.slice(0, NARROW_LABEL - 1).trimEnd()}…`
      : label
  const { nodes, links } = layoutSankey(flow.nodes, flow.links, {
    width: width - labelWidth,
    height: HEIGHT,
    nodeWidth: NODE_WIDTH,
    gap: 8,
  })
  const kindOf = new Map(flow.nodes.map((n) => [n.id, n.kind]))
  // Each column's labels beside their bars, nudged apart where bars are thin.
  const labelY = new Map<string, number>()
  for (const column of new Set(nodes.map((n) => n.node.column))) {
    const placed = nodes.filter((n) => n.node.column === column)
    const ys = spreadLabels(
      placed.map((n) => n.y + n.h / 2),
      narrow ? 28 : 15,
      HEIGHT,
    )
    placed.forEach((n, i) => labelY.set(n.node.id, ys[i]))
  }
  const lit = (from: string, to: string) =>
    !hover || from === hover || to === hover

  if (!flow.nodes.length)
    return (
      <p className="py-6 text-center text-sm text-muted">Nothing spent yet.</p>
    )

  return (
    <div>
      <PaneHeader
        hint={
          takeHome === null ? 'Where the spending went' : 'Where the money went'
        }
      >
        {takeHome !== null && (
          <span className="tabular-nums">
            Take-home{' '}
            <span className="font-semibold text-foreground">
              {dollars(takeHome)}
            </span>
          </span>
        )}
      </PaneHeader>
      <div ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={flowSummary(flow.nodes)}
          className="block overflow-visible"
        >
          {links.map(({ link, path }) => (
            <path
              key={`${link.from}-${link.to}`}
              d={path}
              fill={COLOR[kindOf.get(link.to) ?? 'everyday']}
              opacity={lit(link.from, link.to) ? 0.28 : 0.06}
              className="transition-opacity"
              onPointerEnter={() => setHover(link.to)}
              onPointerLeave={() => setHover(null)}
            >
              <title>{dollars(link.value)}</title>
            </path>
          ))}
          {nodes.map(({ node, x, y, h }) => (
            <g
              key={node.id}
              onPointerEnter={() => setHover(node.id)}
              onPointerLeave={() => setHover(null)}
            >
              <rect
                x={x}
                y={y}
                width={NODE_WIDTH}
                height={Math.max(1, h)}
                rx={2}
                fill={COLOR[node.kind]}
              />
              <text
                x={x + NODE_WIDTH + 6}
                y={(labelY.get(node.id) ?? y + h / 2) - (narrow ? 6 : 0)}
                dominantBaseline="middle"
                className="fill-foreground text-[11px]"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'var(--color-surface)',
                  strokeWidth: 3,
                }}
              >
                <tspan className="font-semibold">{shorten(node.label)}</tspan>
                {narrow ? (
                  <tspan
                    x={x + NODE_WIDTH + 6}
                    dy={13}
                    className="fill-muted tabular-nums"
                  >
                    {compactDollars(node.value)}
                  </tspan>
                ) : (
                  <tspan className="fill-muted tabular-nums">
                    {' '}
                    {compactDollars(node.value)}
                  </tspan>
                )}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {narrow ? (
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
          {TAGS.map((tag) => (
            <span key={tag}>
              <span
                aria-hidden
                className="mr-1 inline-block size-2 rounded-full"
                style={{ background: TAG_FILL[tag] }}
              />
              {TAG_LABELS[tag]}
            </span>
          ))}
          <span>Tap a stream to follow it.</span>
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-muted">
          Hover a stream to follow it. Everyday splits into Need, Nice and
          Fluff, then the biggest Categories.
        </p>
      )}
    </div>
  )
}

/** The flow in words, for screen readers. */
function flowSummary(nodes: Array<MoneyNode>): string {
  const of = (column: number) =>
    nodes
      .filter((n) => n.column === column)
      .map((n) => `${n.label} ${dollars(n.value)}`)
      .join(', ')
  return [of(0), of(1), of(2)].filter(Boolean).join('. Then ') + '.'
}
