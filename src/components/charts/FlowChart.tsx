/**
 * Flow: where the month's money went, as streams from take-home into
 * Housing, planned bills, everyday and what's left, then everyday into
 * Need, Nice and Fluff and their biggest Categories. Narrow, it skips the
 * tags (the colors carry them) and goes straight to the Categories. Hover a
 * stream or a bar for its amount.
 */

import { d3Curve, defineChart, link, rect, text } from '@tanstack/charts'
import { sankeyDiagram } from '@tanstack/charts/network/sankey'
import { Chart } from '@tanstack/charts/react'
import { tooltip } from '@tanstack/charts/tooltip'
import { curveBumpX } from 'd3-shape'
import { useMemo } from 'react'
import { CHART_COLORS, ChartCard, LegendSwatch } from './ChartCard'
import type { FlowKind, FlowLink, MoneyFlow, MoneyNode } from '@/lib/model/flow'
import type { MonthView } from '@/lib/model/month'
import { monthFlow } from '@/lib/model/flow'
import { TAGS, TAG_LABELS } from '@/lib/model/types'
import { compactDollars, dollars } from '@/lib/model/money'
import { TAG_FILL } from '@/lib/format'

const HEIGHT = 360
/** Narrower than this, Flow skips its tag column. */
const NARROW = 520
/** Longest name a narrow chart's last column has room for. */
const NARROW_LABEL = 13

const COLOR: Record<FlowKind, string> = {
  pay: CHART_COLORS.accent,
  left: CHART_COLORS.accent,
  beyond: CHART_COLORS.over,
  housing: 'var(--color-need)',
  planned: CHART_COLORS.planned,
  everyday: CHART_COLORS.foreground,
  rest: CHART_COLORS.muted,
  ...TAG_FILL,
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

export function FlowChart({
  view,
  takeHome,
  bare,
}: {
  view: MonthView
  /** Take-home landing this month; null under a Lens. */
  takeHome: number | null
  bare?: boolean
}) {
  const flows = useMemo(
    () => ({
      full: monthFlow(view, takeHome),
      compact: monthFlow(view, takeHome, { compact: true }),
    }),
    [view, takeHome],
  )
  const definition = useMemo(
    () =>
      defineChart(
        ({ width }) => {
          const narrow = width < NARROW
          const flow: MoneyFlow = narrow ? flows.compact : flows.full
          const labelWidth = narrow ? 92 : Math.min(150, width * 0.22)
          const kindOf = new Map(flow.nodes.map((n) => [n.id, n.kind]))
          const label = (l: string) =>
            narrow && l.length > NARROW_LABEL
              ? `${l.slice(0, NARROW_LABEL - 1).trimEnd()}…`
              : l
          return {
            marks: [
              sankeyDiagram({
                id: 'flow',
                nodes: flow.nodes,
                links: flow.links,
                nodeKey: 'id',
                source: 'from',
                target: 'to',
                value: 'value',
                align: 'left',
                nodeSort: null,
                linkSort: null,
                nodeWidth: 10,
                nodePadding: 8,
                inset: { top: 4, bottom: 4, left: 0, right: labelWidth },
                marks: ({ nodes, links }) => [
                  link(links, {
                    id: 'streams',
                    x1: 'x1',
                    y1: 'y1',
                    x2: 'x2',
                    y2: 'y2',
                    key: 'key',
                    stroke: (l) =>
                      COLOR[kindOf.get((l.data as FlowLink).to) ?? 'everyday'],
                    strokeOpacity: 0.3,
                    strokeWidth: (l) => Math.max(1, l.width),
                    lineCap: 'butt',
                    curve: d3Curve(curveBumpX),
                  }),
                  rect(nodes, {
                    id: 'bars',
                    x1: 'x0',
                    x2: 'x1',
                    y1: 'y0',
                    y2: 'y1',
                    key: 'key',
                    color: (n) => n.data.kind,
                    radius: 2,
                    inset: 0,
                  }),
                  text(nodes, {
                    id: 'names',
                    x: (n) => n.x1 + 6,
                    y: (n) => (narrow ? n.y - 6 : n.y),
                    text: (n) =>
                      narrow
                        ? label(n.data.label)
                        : `${n.data.label} ${compactDollars(n.value)}`,
                    key: 'key',
                    anchor: 'start',
                    fill: CHART_COLORS.foreground,
                    fontSize: 11,
                    fontWeight: 600,
                  }),
                  ...(narrow
                    ? [
                        text(nodes, {
                          id: 'amounts',
                          x: (n) => n.x1 + 6,
                          y: (n) => n.y + 7,
                          text: (n) => compactDollars(n.value),
                          key: 'key',
                          anchor: 'start',
                          fill: CHART_COLORS.muted,
                          fontSize: 11,
                        }),
                      ]
                    : []),
                ],
              }),
            ],
            scales: { x: null, y: null },
            color: {
              domain: Object.keys(COLOR) as Array<FlowKind>,
              range: Object.values(COLOR),
            },
            margin: 0,
          }
        },
        {
          // No focus dot on a stream or bar; the tooltip names what's in view.
          focusRing: false,
          tooltip: {
            use: tooltip,
            content: (points) => {
              const d = points[0]?.datum as
                | {
                    kind: 'link'
                    value: number
                    sourceNode: { data: MoneyNode }
                    targetNode: { data: MoneyNode }
                  }
                | { kind: 'node'; value: number; data: MoneyNode }
                | undefined
              if (!d) return { rows: [] }
              return d.kind === 'link'
                ? {
                    title: `${d.sourceNode.data.label} → ${d.targetNode.data.label}`,
                    rows: [
                      {
                        label: 'Amount',
                        value: dollars(d.value),
                        color: COLOR[d.targetNode.data.kind],
                      },
                    ],
                  }
                : {
                    title: d.data.label,
                    rows: [
                      {
                        label: 'Amount',
                        value: dollars(d.value),
                        color: COLOR[d.data.kind],
                      },
                    ],
                  }
            },
          },
        },
      ),
    [flows],
  )

  return (
    <ChartCard
      bare={bare}
      caption={
        takeHome === null ? 'Where the spending went' : 'Where the money went'
      }
      headline={
        takeHome !== null && (
          <>
            Take-home{' '}
            <span className="font-semibold text-foreground">
              {dollars(takeHome)}
            </span>
          </>
        )
      }
      footer={
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {TAGS.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1">
              <LegendSwatch color={TAG_FILL[tag]} shape="dot" />
              {TAG_LABELS[tag]}
            </span>
          ))}
          <span>Hover or tap a stream for its amount.</span>
        </span>
      }
    >
      {flows.full.nodes.length ? (
        <Chart
          definition={definition}
          height={HEIGHT}
          initialWidth={360}
          ariaLabel={flowSummary(flows.full.nodes)}
        />
      ) : (
        <p className="py-6 text-center text-sm text-muted">
          Nothing spent yet.
        </p>
      )}
    </ChartCard>
  )
}
