/**
 * Where the money goes, as shares: one 100% bar for the typical month and
 * one for the Targets, split by Category and lined up so a share that
 * shrinks (or grows) under the Budget is easy to spot.
 */

import type { MixSlice } from '@/lib/model/mix'
import { EVERYTHING_ELSE } from '@/lib/model/mix'
import { dollars } from '@/lib/model/money'
import { MIX_COLORS, MIX_REST } from '@/lib/format'

const pct = (share: number) => `${Math.round(share * 100)}%`

export function BudgetMix({ slices }: { slices: Array<MixSlice> }) {
  if (!slices.length) return null
  const color = (i: number, name: string) =>
    name === EVERYTHING_ELSE ? MIX_REST : MIX_COLORS[i % MIX_COLORS.length]
  const bar = (label: string, share: (s: MixSlice) => number) => (
    <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="flex h-6 overflow-hidden rounded-md bg-sunken">
        {slices.map((s, i) =>
          share(s) > 0 ? (
            <div
              key={s.name}
              className="flex items-center justify-center overflow-hidden border-r border-surface text-[10px] font-bold text-white last:border-r-0"
              style={{
                width: `${share(s) * 100}%`,
                background: color(i, s.name),
              }}
              title={`${s.name}: ${pct(share(s))}`}
            >
              {share(s) >= 0.07 ? pct(share(s)) : ''}
            </div>
          ) : null,
        )}
      </div>
    </div>
  )
  return (
    <section className="space-y-1.5 rounded-xl border border-border bg-surface p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Share of everyday spending
      </h2>
      {bar('Typical', (s) => s.typicalShare)}
      {bar('Targets', (s) => s.targetShare)}
      <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 pt-1 text-xs min-[420px]:grid-cols-2 sm:grid-cols-3">
        {slices.map((s, i) => {
          const shift = Math.round((s.targetShare - s.typicalShare) * 100)
          return (
            <li key={s.name} className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ background: color(i, s.name) }}
              />
              <span
                className="min-w-0 flex-1 truncate"
                title={`${dollars(s.typical)} typical · ${dollars(s.target)} target`}
              >
                {s.name}
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                {pct(s.typicalShare)} → {pct(s.targetShare)}
              </span>
              <span
                className={`w-7 shrink-0 text-right tabular-nums font-semibold ${
                  shift < 0
                    ? 'text-nice'
                    : shift > 0
                      ? 'text-accent'
                      : 'text-muted'
                }`}
              >
                {shift === 0 ? '' : shift > 0 ? `+${shift}` : `${shift}`}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
