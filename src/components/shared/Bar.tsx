import { cn } from '@/lib/utils'

/**
 * Spent against a Target: the bar fills toward the Target and turns red
 * past it; `pace` marks where spending "should" be by today.
 */
export function Bar({
  spent,
  target,
  pace,
  planned = 0,
  className,
}: {
  spent: number
  target: number | null
  /** 0–1 share of the month gone, when it's the current month. */
  pace?: number
  /** Still-to-come Planned Expenses, drawn after what's spent. */
  planned?: number
  className?: string
}) {
  const scale = Math.max(target ?? 0, spent + planned, 1)
  const over = target !== null && spent > target
  return (
    <div
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-sunken',
        className,
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 rounded-full',
          over ? 'bg-over' : 'bg-accent',
        )}
        style={{ width: `${(Math.max(spent, 0) / scale) * 100}%` }}
      />
      {planned > 0 && (
        <div
          className="absolute inset-y-0 rounded-full bg-planned/50"
          style={{
            left: `${(Math.max(spent, 0) / scale) * 100}%`,
            width: `${(planned / scale) * 100}%`,
          }}
        />
      )}
      {target !== null && target < scale && (
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: `${(target / scale) * 100}%` }}
          title="Target"
        />
      )}
      {pace !== undefined && pace > 0 && pace < 1 && target !== null && (
        <div
          className="absolute -inset-y-0 w-px bg-foreground/40"
          style={{ left: `${((target * pace) / scale) * 100}%` }}
          title="Where today's spending would be on pace"
        />
      )}
    </div>
  )
}
