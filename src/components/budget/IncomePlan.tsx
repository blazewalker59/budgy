/**
 * The Budget against take-home pay: how much of it a typical month and the
 * Budget spend on everyday things, housing and planned bills, and what's
 * left (charts/IncomeChart), with each part as a percent below.
 */

import { ChevronRight } from 'lucide-react'
import type { IncomeSplit, TakeHome } from '@/lib/model/income'
import { dollars, signedDollars } from '@/lib/model/money'
import { SPLIT_COLORS, SPLIT_LABELS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { IncomeChart } from '@/components/charts/lazy'

const pct = (share: number) => `${Math.round(share * 100)}%`
const COLUMNS = ['everyday', 'housing', 'planned', 'left'] as const
const GRID =
  'grid grid-cols-[3.25rem_repeat(3,minmax(0,1fr))_minmax(0,1.6fr)] items-baseline gap-x-2'

export function IncomePlan({
  pay,
  typical,
  budget,
  onOpen,
}: {
  pay: TakeHome
  typical: IncomeSplit
  budget: IncomeSplit
  onOpen: () => void
}) {
  if (pay.basis === 'none')
    return (
      <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted">
        No income imported yet. Import an export that includes paychecks to see
        the Budget as a share of take-home pay.
      </p>
    )
  const row = (label: string, s: IncomeSplit) => (
    <div className={cn(GRID, 'text-[13px] tabular-nums')}>
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      {s.parts.map((p) => (
        <span key={p.part} title={`${dollars(p.amount)}/mo`}>
          {pct(p.share)}
        </span>
      ))}
      <span
        className={cn(
          'truncate font-semibold',
          s.left < 0 ? 'text-over' : 'text-accent',
        )}
      >
        {s.left < 0 ? '−' : ''}
        {pct(Math.abs(1 - s.spentShare))}
        <span className="ml-1 text-[11px] font-normal text-muted">
          {signedDollars(s.left)}
        </span>
      </span>
    </div>
  )
  return (
    <section className="space-y-1.5 rounded-xl border border-border bg-surface p-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Of take-home pay
          <span className="ml-1.5 font-normal normal-case tracking-normal">
            {dollars(pay.monthly)}/mo
            {pay.basis === 'deposits' && ' (all deposits)'}
          </span>
        </h2>
        <span className="flex items-center text-[11px] font-semibold text-accent">
          Pay
          <ChevronRight size={13} aria-hidden />
        </span>
      </button>
      <IncomeChart
        income={pay.monthly}
        rows={{ Typical: typical, Budget: budget }}
      />
      <div className="space-y-0.5 pt-1">
        <div className={cn(GRID, 'text-[10px] text-muted sm:text-[11px]')}>
          <span />
          {COLUMNS.map((c) => (
            <span key={c} className="flex min-w-0 items-center gap-1">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ background: SPLIT_COLORS[c] }}
              />
              <span className="truncate">
                {c === 'planned' ? 'Planned' : SPLIT_LABELS[c]}
              </span>
            </span>
          ))}
        </div>
        {row('Typical', typical)}
        {row('Budget', budget)}
      </div>
    </section>
  )
}
