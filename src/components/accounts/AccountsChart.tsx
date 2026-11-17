/**
 * Every Account over time, as change: each kind's line starts at zero on
 * the first day and moves with its gains and losses, net worth in bold
 * (charts/AccountLines), so a few hundred dollars shows even beside a
 * house. The key gives each one's balance with its change; tap a kind for
 * its Accounts.
 */

import { useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { AccountName } from './AccountName'
import { dayWithYear } from './WorthSheet'
import type { LineSeries } from '@/components/charts/AccountLines'
import type { AccountsOverTime } from '@/lib/model/accountsOverTime'
import { dollars, signedDollars } from '@/lib/model/money'
import { ACCOUNT_GROUP_COLORS, MIX_COLORS, MIX_REST } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ChartCard, LegendSwatch } from '@/components/charts/ChartCard'
import { AccountLines } from '@/components/charts/lazy'

const since = (values: Array<number>) => values.map((v) => v - values[0])

export function AccountsChart({
  data,
  today,
  headline,
}: {
  data: AccountsOverTime
  today: string
  headline: React.ReactNode
}) {
  const [open, setOpen] = useState<string | null>(null)
  const group = data.groups.find((g) => g.title === open) ?? null

  const { series, total, labels } = useMemo(() => {
    const labelOf = new Map<string, React.ReactNode>()
    const list: Array<LineSeries> = group
      ? group.accounts.map((l, i) => {
          labelOf.set(l.account.name, <AccountName account={l.account} />)
          return {
            key: l.account.name,
            name: l.account.displayName || l.account.name,
            color: MIX_COLORS[i % MIX_COLORS.length],
            balances: l.values,
            change: since(l.values),
          }
        })
      : data.groups.map((g) => ({
          key: g.title,
          name: g.title,
          color: ACCOUNT_GROUP_COLORS[g.title] ?? MIX_REST,
          balances: g.values,
          change: since(g.values),
        }))
    const values = group ? group.values : data.net
    return {
      series: list,
      total: {
        key: 'total',
        name: group ? group.title : 'Net worth',
        color: 'var(--color-foreground)',
        balances: values,
        change: since(values),
      },
      labels: labelOf,
    }
  }, [data, group])
  const label = useMemo(
    () => (date: string) => dayWithYear(date, today),
    [today],
  )

  const last = data.dates.length - 1
  if (last < 1 || !series.length) return null
  const first = label(data.dates[0])

  return (
    <ChartCard
      caption={
        group ? (
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="inline-flex items-center gap-0.5 font-semibold text-accent"
          >
            <ChevronLeft size={14} aria-hidden />
            All accounts
          </button>
        ) : (
          <span>How each kind of account moved since {first}</span>
        )
      }
      headline={headline}
      footer={
        <>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-[13px] text-foreground sm:grid-cols-2">
            {series.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={!!group}
                  onClick={() => setOpen(s.key)}
                  aria-label={
                    group
                      ? undefined
                      : `${s.name}, ${dollars(s.balances[last])}, ${signedDollars(s.change[last])} since ${first}: see its accounts`
                  }
                  className="flex w-full items-center gap-2 rounded py-0.5 text-left enabled:hover:bg-sunken/50"
                >
                  <LegendSwatch color={s.color} shape="line" />
                  <span className="min-w-0 flex-1 truncate">
                    {labels.get(s.key) ?? s.name}
                  </span>
                  <span className="text-muted tabular-nums">
                    {dollars(s.balances[last])}
                  </span>
                  <Change cents={s.change[last]} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5">
            Each line starts at zero on {first}; the bold one is{' '}
            {total.name.toLowerCase()}.
            {!group && ' Tap a kind of account for its accounts.'}
          </p>
        </>
      }
    >
      <AccountLines
        dates={data.dates}
        series={series}
        total={total}
        label={label}
      />
    </ChartCard>
  )
}

/** A change since the first day: green up, red down. */
function Change({ cents }: { cents: number }) {
  // By the dollars shown: a few cents either way reads as no change.
  const shown = Math.round(cents / 100)
  return (
    <span
      className={cn(
        'w-16 shrink-0 text-right font-semibold tabular-nums',
        shown > 0 ? 'text-accent' : shown < 0 ? 'text-over' : 'text-muted',
      )}
    >
      {signedDollars(cents)}
    </span>
  )
}
