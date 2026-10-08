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
 * - Import charts through ./lazy, so the library loads only when shown.
 */

import { cn } from '@/lib/utils'

export const CHART_COLORS = {
  accent: 'var(--color-accent)',
  over: 'var(--color-over)',
  planned: 'var(--color-planned)',
  muted: 'var(--color-muted)',
  foreground: 'var(--color-foreground)',
} as const

export interface LegendItem {
  label: string
  color: string
  shape?: 'box' | 'line' | 'dot'
}

export function ChartCard({
  legend = [],
  headline,
  children,
  className,
  footer,
}: {
  legend?: ReadonlyArray<LegendItem>
  headline?: React.ReactNode
  children: React.ReactNode
  className?: string
  footer?: React.ReactNode
}) {
  return (
    <figure
      className={cn(
        'rounded-xl border border-border bg-surface px-2 py-2 text-muted',
        className,
      )}
    >
      {(legend.length > 0 || headline) && (
        <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1 text-[11px]">
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block',
                    l.shape === 'line'
                      ? 'h-0.5 w-3'
                      : l.shape === 'dot'
                        ? 'size-2 rounded-full'
                        : 'size-2 rounded-sm',
                  )}
                  style={{ background: l.color }}
                />
                {l.label}
              </span>
            ))}
          </span>
          {headline && <span>{headline}</span>}
        </figcaption>
      )}
      {children}
      {footer && <div className="mt-1 px-1 text-[11px]">{footer}</div>}
    </figure>
  )
}
