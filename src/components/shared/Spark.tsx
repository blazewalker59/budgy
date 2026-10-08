import { cn } from '@/lib/utils'

/**
 * Monthly spending as tiny bars, newest on the right, with the Target as a
 * line: a trend at a glance.
 */
export function Spark({
  values,
  target,
  highlight = values.length,
  className,
}: {
  values: Array<number>
  target?: number | null
  /** How many of the newest bars to draw strong (the averaged months). */
  highlight?: number
  className?: string
}) {
  const max = Math.max(...values, target ?? 0, 1)
  const w = 4
  const gap = 1.25
  const width = values.length * (w + gap) - gap
  const h = 18
  return (
    <svg
      viewBox={`0 0 ${width} ${h}`}
      width={width}
      height={h}
      className={cn('shrink-0 overflow-visible', className)}
      aria-hidden
    >
      {values.map((v, i) => {
        const bh = Math.max((Math.max(v, 0) / max) * h, v > 0 ? 1 : 0)
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={h - bh}
            width={w}
            height={bh}
            rx={1}
            className={
              i < values.length - highlight
                ? 'fill-muted/35'
                : target != null && v > target
                  ? 'fill-over'
                  : 'fill-accent'
            }
          />
        )
      })}
      {target != null && target > 0 && (
        <line
          x1={-1}
          x2={width + 1}
          y1={h - (target / max) * h}
          y2={h - (target / max) * h}
          className="stroke-foreground/60"
          strokeWidth={0.75}
          strokeDasharray="2 1.5"
        />
      )}
    </svg>
  )
}
