/**
 * Coming up on Overview: unpaid due dates, grouped by how near they are
 * (late, this week, next week, later this month, after). The nearer a
 * group, the louder it reads; the "in N days" and amounts line up in
 * columns across every row.
 */

import type { Occurrence } from '@/lib/model/plans'
import type { Horizon } from '@/lib/model/dates'
import { dayLabel, horizon, relativeDays } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'
import { Section } from '@/components/shared/Layout'

const GROUPS: ReadonlyArray<{
  key: Horizon
  title: string
  /** The group's heading. */
  heading: string
  /** Each row in the group. */
  row: string
  name: string
  when: string
  amount: string
}> = [
  {
    key: 'late',
    title: 'Late',
    heading: 'text-over',
    row: 'bg-over-soft/50',
    name: 'font-semibold',
    when: 'font-semibold text-over',
    amount: 'font-bold',
  },
  {
    key: 'thisWeek',
    title: 'This week',
    heading: 'text-planned',
    row: 'bg-planned-soft/60',
    name: 'font-semibold',
    when: 'font-semibold text-planned',
    amount: 'font-bold',
  },
  {
    key: 'nextWeek',
    title: 'Next week',
    heading: 'text-planned',
    row: '',
    name: 'font-semibold',
    when: 'font-semibold text-planned',
    amount: 'font-bold',
  },
  {
    key: 'thisMonth',
    title: 'Later this month',
    heading: 'text-muted',
    row: '',
    name: 'font-medium',
    when: 'text-planned/75',
    amount: 'font-semibold',
  },
  {
    key: 'later',
    title: 'After this month',
    heading: 'text-muted',
    row: '',
    name: 'font-medium text-foreground/80',
    when: 'text-muted',
    amount: 'font-semibold text-muted',
  },
]

export function ComingUp({
  items,
  today,
}: {
  items: Array<Occurrence>
  today: string
}) {
  const groups = GROUPS.map((g) => ({
    ...g,
    items: items.filter((o) => horizon(today, o.due) === g.key),
  })).filter((g) => g.items.length > 0)
  return (
    <Section title="Coming up" hint="next 60 days, unpaid">
      {/* One grid so "in N days" and the amounts line up in every row. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 text-[13px] tabular-nums">
        {groups.map((g, i) => (
          <section
            key={g.key}
            aria-label={g.title}
            className={cn(
              'col-span-3 grid grid-cols-subgrid',
              i > 0 && 'border-t border-border',
            )}
          >
            <h3
              className={cn(
                'col-span-3 grid grid-cols-subgrid items-baseline bg-sunken/60 px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase',
                g.heading,
              )}
            >
              <span className="col-span-2">{g.title}</span>
              <span className="text-right">
                {dollars(g.items.reduce((s, o) => s + o.plan.amount, 0))}
              </span>
            </h3>
            <ul className="col-span-3 grid grid-cols-subgrid divide-y divide-border">
              {g.items.map((o) => (
                <li
                  key={`${o.plan.id}-${o.due}`}
                  className={cn(
                    'col-span-3 grid grid-cols-subgrid items-center px-3 py-1.5',
                    g.row,
                  )}
                >
                  <span className="min-w-0 truncate">
                    <span className={g.name}>{o.plan.name}</span>
                    <span className="text-muted"> · {dayLabel(o.due)}</span>
                  </span>
                  <span className={cn('text-xs', g.when)}>
                    {o.due < today
                      ? `due ${relativeDays(today, o.due)}`
                      : relativeDays(today, o.due)}
                  </span>
                  <span className={cn('text-right', g.amount)}>
                    {dollars(o.plan.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Section>
  )
}
