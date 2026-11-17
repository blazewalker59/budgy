/**
 * The frame every chart sits in (src/components/charts), as in sportsline:
 * a surface card, a caption row with a legend on the left and a headline
 * figure on the right, then the chart. Charts are TanStack Charts
 * (@tanstack/charts) rendered as SVG through `Chart` from
 * '@tanstack/charts/react'.
 *
 * Conventions, so the app's charts read as one family:
 * - Colors come from theme tokens (CHART_COLORS, CSS variables), so light
 *   and dark follow; tooltips are themed in styles.css (.ts-chart-tooltip).
 * - The card sets `color: var(--muted)`, which the library uses for axes,
 *   ticks and grid lines.
 * - Memoize each chart definition (useMemo) on the data it captures.
 * - Give every Chart an `ariaLabel` that states the takeaway, and a fixed
 *   `height` with `initialWidth`.
 * - Tooltips are the library's (`tooltip` with `content` rows), not custom.
 * - Import charts through ./lazy, so the library loads only when shown.
 */

import { cn } from '@/lib/utils'

export const CHART_COLORS = {
  accent: 'var(--color-accent)',
  over: 'var(--color-over)',
  planned: 'var(--color-planned)',
  muted: 'var(--color-muted)',
  foreground: 'var(--color-foreground)',
  border: 'var(--color-border)',
  surface: 'var(--color-surface)',
} as const

export interface LegendItem {
  label: string
  color: string
  shape?: 'box' | 'line' | 'dot'
}

export function ChartCard({
  legend = [],
  caption,
  headline,
  children,
  className,
  footer,
  bare,
}: {
  legend?: ReadonlyArray<LegendItem>
  /** Before the legend: what the chart shows, or a way back. */
  caption?: React.ReactNode
  headline?: React.ReactNode
  children: React.ReactNode
  className?: string
  footer?: React.ReactNode
  /** No card of its own, inside one that already is (Overview's visuals). */
  bare?: boolean
}) {
  return (
    <figure
      className={cn(
        'text-muted',
        !bare && 'rounded-xl border border-border bg-surface px-2 py-2',
        className,
      )}
    >
      {(caption || legend.length > 0 || headline) && (
        <figcaption
          className={cn(
            'mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs',
            !bare && 'px-1',
          )}
        >
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {caption}
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <LegendSwatch color={l.color} shape={l.shape} />
                {l.label}
              </span>
            ))}
          </span>
          {headline && <span className="tabular-nums">{headline}</span>}
        </figcaption>
      )}
      {children}
      {footer && (
        <div className={cn('mt-1 text-xs', !bare && 'px-1')}>{footer}</div>
      )}
    </figure>
  )
}

/** A legend's mark: a box, a short line or a dot in the series' color. */
export function LegendSwatch({
  color,
  shape = 'box',
}: {
  color: string
  shape?: LegendItem['shape']
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block shrink-0',
        shape === 'line'
          ? 'h-0.5 w-3'
          : shape === 'dot'
            ? 'size-2 rounded-full'
            : 'size-2 rounded-sm',
      )}
      style={{ background: color }}
    />
  )
}
