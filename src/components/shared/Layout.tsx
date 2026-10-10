/** Compact building blocks shared by every screen. */

import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Stat({
  label,
  value,
  detail,
  tone,
  tappable,
  children,
}: {
  label: string
  value: string
  detail?: string
  tone?: 'over' | 'planned' | 'good'
  /** Shows it opens more, with a chevron by the label. */
  tappable?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface px-3 py-2">
      <p className="flex items-center gap-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span className="truncate">{label}</span>
        {tappable && (
          <ChevronRight size={12} className="shrink-0" aria-hidden />
        )}
      </p>
      <p className="text-xl font-extrabold leading-tight tracking-tight">
        {value}
      </p>
      {detail && (
        <p
          className={cn(
            'truncate text-xs text-muted',
            tone === 'over' && 'font-semibold text-over',
            tone === 'planned' && 'font-semibold text-planned',
            tone === 'good' && 'font-semibold text-accent',
          )}
        >
          {detail}
        </p>
      )}
      {children}
    </div>
  )
}

export function Section({
  title,
  hint,
  action,
  children,
  bare,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
  /** No card around the children. */
  bare?: boolean
}) {
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
          {title}
          {hint && (
            <span className="ml-2 font-normal normal-case tracking-normal">
              {hint}
            </span>
          )}
        </h2>
        {action}
      </div>
      {bare ? (
        children
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {children}
        </div>
      )}
    </section>
  )
}

/** A row of choices, one selected. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  label: string
  /** lg: a screen's own sections, beside its title. */
  size?: 'md' | 'lg'
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex w-fit rounded-full bg-sunken',
        size === 'lg' ? 'p-1' : 'p-0.5',
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full font-semibold text-muted',
            size === 'lg' ? 'min-h-9 px-4 text-sm' : 'px-2.5 py-0.5 text-xs',
            value === o.value && 'bg-surface text-foreground shadow-sm',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
