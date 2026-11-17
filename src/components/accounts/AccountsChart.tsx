/**
 * Every Account over time, as change: each group's line starts at zero on
 * the first day and moves with its gains and losses, net worth in bold,
 * so a few hundred dollars shows even beside a house. The key and the
 * tooltip give each one's balance with its change. Tap a group for its
 * Accounts; hover or tap a day for the numbers on it.
 */

import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { AccountName } from './AccountName'
import { dayWithYear } from './WorthSheet'
import type { AccountsOverTime, GroupLine } from '@/lib/model/accountsOverTime'
import { niceTicksBetween } from '@/lib/layout/ticks'
import { compactDollars, dollars, signedDollars } from '@/lib/model/money'
import { MIX_COLORS, MIX_REST } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWidth } from '@/components/shared/useWidth'

const HEIGHT = 220
const PAD = { left: 48, right: 12, top: 10, bottom: 24 }

/** Each group one color, the same wherever it shows. */
const GROUP_COLOR: Record<string, string> = {
  Cash: '#1f9a78',
  'Credit cards': '#e0663f',
  Investments: '#2f7fc1',
  Retirement: '#7d5cf0',
  Education: '#d39a2a',
  'Home & property': '#3db3c9',
  Loans: '#d1497f',
  Other: MIX_REST,
}

interface Series {
  key: string
  label: React.ReactNode
  /** For the tooltip and screen readers. */
  name: string
  color: string
  /** Toward net worth at each date. */
  balances: Array<number>
  /** Since the first date. */
  change: Array<number>
  group?: GroupLine
}

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
  const [ref, width] = useWidth()
  const [open, setOpen] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const group = data.groups.find((g) => g.title === open) ?? null

  const series: Array<Series> = group
    ? group.accounts.map((l, i) => ({
        key: l.account.name,
        label: <AccountName account={l.account} />,
        name: l.account.displayName || l.account.name,
        color: MIX_COLORS[i % MIX_COLORS.length],
        balances: l.values,
        change: since(l.values),
      }))
    : data.groups.map((g) => ({
        key: g.title,
        label: g.title,
        name: g.title,
        color: GROUP_COLOR[g.title] ?? MIX_REST,
        balances: g.values,
        change: since(g.values),
        group: g,
      }))
  const total = group ? group.values : data.net
  const line = since(total)
  const lineName = group ? group.title : 'Net worth'
  const points = data.dates.length
  const last = points - 1

  const reach = [...series.flatMap((s) => s.change), ...line]
  const ticks = niceTicksBetween(Math.min(...reach), Math.max(...reach))
  const top = ticks[ticks.length - 1]
  const bottom = ticks[0]
  const x = (i: number) =>
    PAD.left + (i / Math.max(1, last)) * (width - PAD.left - PAD.right)
  const y = (v: number) =>
    PAD.top + ((top - v) / (top - bottom)) * (HEIGHT - PAD.top - PAD.bottom)
  const path = (values: Array<number>) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')
  const dayAt = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const share =
      (e.clientX - r.left - PAD.left) / (width - PAD.left - PAD.right)
    return Math.max(0, Math.min(last, Math.round(share * last)))
  }
  const labelDays = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * last))
  const first = dayWithYear(data.dates[0], today)

  if (points < 2 || !series.length) return null

  return (
    <figure className="rounded-xl border border-border bg-surface p-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px] text-muted">
        {group ? (
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
        )}
        <span className="tabular-nums">{headline}</span>
      </figcaption>
      <div ref={ref} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Since ${first}: ${lineName} ${signedDollars(line[last])}, ${series
            .map((s) => `${s.name} ${signedDollars(s.change[last])}`)
            .join(', ')}.`}
          className="block touch-pan-y select-none"
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse') setHover(dayAt(e))
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setHover(null)
          }}
          onClick={(e) => {
            const day = dayAt(e)
            setHover(hover === day ? null : day)
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-border)"
                strokeWidth={t === 0 ? 1.5 : 1}
              />
              <text
                x={PAD.left - 6}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-muted text-[10px] tabular-nums"
              >
                {t > 0 ? '+' : ''}
                {compactDollars(t)}
              </text>
            </g>
          ))}
          {series.map((s) => (
            <path
              key={s.key}
              d={path(s.change)}
              fill="none"
              stroke={s.color}
              strokeWidth={1.75}
              strokeLinejoin="round"
              className="pointer-events-none"
            />
          ))}
          <path
            d={path(line)}
            fill="none"
            stroke="var(--color-foreground)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            className="pointer-events-none"
          />
          {labelDays.map((d, i) => (
            <text
              key={i}
              x={x(d)}
              y={HEIGHT - 4}
              textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
              className="fill-muted text-[10px]"
            >
              {dayWithYear(data.dates[d], today)}
            </text>
          ))}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--color-foreground)"
              opacity={0.4}
              className="pointer-events-none"
            />
          )}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-64 rounded-lg border border-border bg-surface/95 p-2 text-xs shadow-lg backdrop-blur"
            style={{ left: Math.max(0, Math.min(x(hover) + 8, width - 264)) }}
          >
            <p className="font-semibold">
              {dayWithYear(data.dates[hover], today)}
            </p>
            <Line
              name={lineName}
              balance={total[hover]}
              change={line[hover]}
              bold
            />
            {series.map((s) => (
              <Line
                key={s.key}
                name={s.name}
                color={s.color}
                balance={s.balances[hover]}
                change={s.change[hover]}
              />
            ))}
          </div>
        )}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[13px] sm:grid-cols-2">
        {series.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              disabled={!s.group}
              onClick={() => setOpen(s.key)}
              aria-label={
                s.group
                  ? `${s.name}, ${dollars(s.balances[last])}, ${signedDollars(s.change[last])} since ${first}: see its accounts`
                  : undefined
              }
              className="flex w-full items-center gap-2 rounded py-0.5 text-left enabled:hover:bg-sunken/50"
            >
              <span
                aria-hidden
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="text-muted tabular-nums">
                {dollars(s.balances[last])}
              </span>
              <Change cents={s.change[last]} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted">
        Each line starts at zero on {first}; the bold one is{' '}
        {lineName.toLowerCase()}.
        {!group && ' Tap a kind of account for its accounts.'}
      </p>
    </figure>
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

/** One row of the tooltip: name, balance and change. */
function Line({
  name,
  color,
  balance,
  change,
  bold,
}: {
  name: string
  color?: string
  balance: number
  change: number
  bold?: boolean
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 tabular-nums',
        bold && 'font-semibold',
      )}
    >
      {color ? (
        <span
          aria-hidden
          className="h-0.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
      ) : (
        <span aria-hidden className="w-2.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="text-muted">{dollars(balance)}</span>
      <Change cents={change} />
    </p>
  )
}
