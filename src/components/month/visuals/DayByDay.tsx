/**
 * Day by day: the month as a calendar, each day shaded by its everyday
 * spending, with weekly totals. Days ahead show the bills due and paydays.
 * Tap a day for its purchases.
 */

import { useState } from 'react'
import { PaneHeader } from './PaneHeader'
import type { MonthView } from '@/lib/model/month'
import type { Occurrence } from '@/lib/model/plans'
import { SPEND_LEVELS, dailySpend, spendLevels } from '@/lib/model/pace'
import { dayLabel, monthWeeks } from '@/lib/model/dates'
import { compactDollars, dollars } from '@/lib/model/money'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Each step's shade (styles.css): the usual text reads on all of them. */
const shade = (level: number) =>
  level ? `var(--heat-${level})` : 'var(--color-sunken)'

export function DayByDay({
  view,
  today,
  paydays,
  bills,
}: {
  view: MonthView
  today: string
  paydays: Array<string>
  bills: Array<Occurrence>
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const month = view.month
  const daily = dailySpend(view)
  const spentOn = (date: string) =>
    date.slice(0, 7) === month ? daily[Number(date.slice(8, 10)) - 1] : 0
  const levels = spendLevels(daily)
  const levelOn = (date: string) =>
    date.slice(0, 7) === month ? levels[Number(date.slice(8, 10)) - 1] : 0
  const biggest = daily.reduce(
    (best, d, i) => (d > best.amount ? { day: i, amount: d } : best),
    { day: -1, amount: 0 },
  )
  const txns = view.everyday
    .flatMap((c) => c.txns.map((t) => ({ ...t, category: c.name })))
    .filter((t) => t.date === picked)
    .sort((a, b) => b.amount - a.amount)

  return (
    <div>
      <PaneHeader
        hint={
          <span className="inline-flex items-center gap-1">
            Less
            {Array.from({ length: SPEND_LEVELS }, (_, i) => (
              <span
                key={i}
                aria-hidden
                className="inline-block size-3 rounded-sm"
                style={{ background: shade(i + 1) }}
              />
            ))}
            More
          </span>
        }
      >
        {biggest.day >= 0 && (
          <span className="tabular-nums">
            Biggest day{' '}
            <span className="font-semibold text-foreground">
              {dayLabel(`${month}-${String(biggest.day + 1).padStart(2, '0')}`)}{' '}
              · {dollars(biggest.amount)}
            </span>
          </span>
        )}
      </PaneHeader>
      <div
        role="group"
        aria-label="Spending by day"
        className="grid grid-cols-7 gap-1 text-[11px] sm:grid-cols-[repeat(7,minmax(0,1fr))_auto]"
      >
        {WEEKDAYS.map((d, i) => (
          <span
            key={i}
            aria-hidden
            className="text-center font-semibold text-muted"
          >
            {d}
          </span>
        ))}
        <span
          aria-hidden
          className="hidden pl-1 text-right font-semibold text-muted sm:block"
        >
          Week
        </span>
        {monthWeeks(month).map((week) => {
          const weekTotal = week.reduce((n, d) => n + spentOn(d), 0)
          return [
            ...week.map((date) => {
              const inMonth = date.slice(0, 7) === month
              if (!inMonth) return <span key={date} aria-hidden />
              const amount = spentOn(date)
              const level = levelOn(date)
              const ahead = date > today
              const due = bills.filter((o) => o.due === date)
              const label = [
                dayLabel(date),
                amount ? dollars(amount) : ahead ? null : 'nothing spent',
                paydays.includes(date) && 'payday',
                ...due.map(
                  (o) => `${o.plan.name} ${o.paidBy ? 'paid' : 'due'}`,
                ),
              ]
                .filter(Boolean)
                .join(', ')
              return (
                <button
                  type="button"
                  key={date}
                  aria-label={label}
                  aria-pressed={picked === date}
                  onClick={() => setPicked(picked === date ? null : date)}
                  className={cn(
                    'flex min-h-12 min-w-0 flex-col items-stretch rounded-md border p-1 text-left sm:min-h-14',
                    date === today
                      ? 'border-foreground'
                      : picked === date
                        ? 'border-accent'
                        : ahead
                          ? 'border-dashed border-border'
                          : 'border-transparent',
                  )}
                  style={{ background: shade(level) }}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        'font-semibold',
                        ahead ? 'text-muted' : 'text-foreground',
                      )}
                    >
                      {Number(date.slice(8, 10))}
                    </span>
                    {paydays.includes(date) && (
                      <span className="hidden rounded bg-accent px-1 text-[9px] font-bold text-surface sm:inline">
                        PAY
                      </span>
                    )}
                    <Marks payday={paydays.includes(date)} due={due} />
                  </span>
                  {amount > 0 && (
                    <span className="mt-auto truncate font-semibold tabular-nums">
                      {compactDollars(amount)}
                    </span>
                  )}
                  {due.length > 0 && <BillLine due={due} />}
                </button>
              )
            }),
            <span
              key={`${week[0]}-week`}
              aria-label={`Week of ${dayLabel(week[0])}: ${dollars(weekTotal)}`}
              className="hidden self-center pl-1 text-right font-semibold text-muted tabular-nums sm:block"
            >
              {weekTotal ? compactDollars(weekTotal) : ''}
            </span>,
          ]
        })}
      </div>
      {picked ? (
        <div className="mt-2 rounded-lg bg-sunken p-2 text-xs">
          <p className="mb-1 font-semibold">
            {dayLabel(picked)} · {dollars(spentOn(picked))}
          </p>
          {paydays.includes(picked) && <p className="text-accent">Payday</p>}
          {bills
            .filter((o) => o.due === picked)
            .map((o) => (
              <p
                key={o.plan.id}
                className="flex justify-between gap-2 text-planned tabular-nums"
              >
                <span className="truncate">
                  {o.plan.name} · {o.paidBy ? 'paid' : 'due'}
                </span>
                <span className="font-semibold">{dollars(o.plan.amount)}</span>
              </p>
            ))}
          {!txns.length && <p className="text-muted">Nothing spent.</p>}
          <ul>
            {txns.map((t) => (
              <li
                key={t.id}
                className="flex justify-between gap-2 tabular-nums"
              >
                <span className="truncate">
                  {t.store} <span className="text-muted">· {t.category}</span>
                </span>
                <span className="font-semibold">{dollars(t.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-muted">
          Tap a day for its purchases and bills. Dashed days are ahead.
        </p>
      )}
    </div>
  )
}

/** A bill's dot: filled once paid, ringed so it shows on any shade. */
function BillDot({ bill }: { bill: Occurrence }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full border border-planned ring-1 ring-surface',
        bill.paidBy ? 'bg-planned' : 'bg-surface',
      )}
    />
  )
}

/** Dots shown for a day's bills, however many there are. */
const MAX_DOTS = 3

/**
 * A day's bills on one line where there's room: their dots, then the
 * bill's name, or how many when there are several (tapping the day lists
 * them all). Never wider than the day.
 */
function BillLine({ due }: { due: Array<Occurrence> }) {
  return (
    <span className="hidden min-w-0 items-center gap-1 overflow-hidden text-[10px] leading-tight whitespace-nowrap text-foreground sm:flex">
      <span aria-hidden className="flex shrink-0 gap-0.5">
        {due.slice(0, MAX_DOTS).map((o) => (
          <BillDot key={o.plan.id} bill={o} />
        ))}
      </span>
      <span className="min-w-0 truncate">
        {due.length === 1 ? due[0].plan.name : `${due.length} bills`}
      </span>
    </span>
  )
}

/** A phone's day is too narrow for names: payday as $, bills as dots. */
function Marks({ payday, due }: { payday: boolean; due: Array<Occurrence> }) {
  if (!payday && !due.length) return null
  return (
    <span aria-hidden className="flex items-center gap-0.5 sm:hidden">
      {payday && (
        <span className="rounded-full bg-accent px-1 text-[9px] leading-tight font-bold text-surface">
          $
        </span>
      )}
      {due.slice(0, MAX_DOTS).map((o) => (
        <BillDot key={o.plan.id} bill={o} />
      ))}
    </span>
  )
}
