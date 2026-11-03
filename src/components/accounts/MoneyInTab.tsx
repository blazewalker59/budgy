/**
 * Money in (docs/adr/0011): what came into the bank Accounts, by month.
 * Paychecks and transfers are recognized; anything else (Venmo, Zelle, a
 * mobile deposit) waits to be reviewed. Filing one as an Offset takes it,
 * or part of it, off a spending Category as a refund.
 */
import { useMemo, useState } from 'react'
import type { MoneyIn, MoneyInUse } from '@/lib/model/moneyIn'
import {
  MONEY_IN_LABELS,
  MONEY_IN_USES,
  moneyInByMonth,
} from '@/lib/model/moneyIn'
import { useFileMoneyIn, useMoneyIn } from '@/lib/moneyIn/useMoneyIn'
import { useBook } from '@/lib/ledger/book'
import { TRANSFER } from '@/lib/model/ledger'
import { dayLabel, monthLabel } from '@/lib/model/dates'
import { dollars, money, parseDollars } from '@/lib/model/money'
import { ownerColor } from '@/lib/format'
import { CategorySelect } from '@/components/shared/CategorySelect'
import { Dropdown } from '@/components/shared/Dropdown'
import { Segmented, Stat } from '@/components/shared/Layout'
import { AccountRef } from '@/components/accounts/AccountName'

type Show = 'review' | 'all'

export function MoneyInTab() {
  const query = useMoneyIn()
  const items = useMemo(() => query.data ?? [], [query.data])
  const toReview = items.filter((m) => m.use === 'review').length
  const [chosen, setShow] = useState<Show | null>(null)
  const show: Show = chosen ?? (toReview ? 'review' : 'all')
  const months = useMemo(() => moneyInByMonth(items), [items])
  const latest = months.at(0)

  if (query.isPending)
    return <p className="px-1 text-xs text-muted">Loading money in…</p>
  if (query.isError)
    return (
      <p role="alert" className="px-1 text-xs text-over">
        {query.error.message}
      </p>
    )
  if (!items.length)
    return (
      <section className="rounded-xl border border-border bg-surface p-3 text-xs text-muted">
        <p className="font-semibold text-foreground">No money in yet.</p>
        <p>
          Money coming into checking and savings accounts shows up here after
          their next update: a bank sync, or an uploaded export.
        </p>
      </section>
    )

  const shown =
    show === 'review' ? items.filter((m) => m.use === 'review') : items
  const byMonth = new Map<string, Array<MoneyIn>>()
  for (const m of shown)
    byMonth.set(m.month, [...(byMonth.get(m.month) ?? []), m])

  return (
    <>
      {latest && (
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label={`Income · ${monthLabel(latest.month)}`}
            value={dollars(latest.income)}
          />
          <Stat
            label="Offsets"
            value={dollars(latest.offsets)}
            tone={latest.offsets ? 'good' : undefined}
          />
          <Stat
            label="To review"
            value={String(toReview)}
            tone={toReview ? 'planned' : undefined}
          />
        </div>
      )}
      <p className="px-1 text-xs text-muted">
        Money in never counts as spending by itself. File money that pays you
        back (a Venmo for a shared purchase) as an <strong>Offset</strong> and
        it comes off that category, like a refund.
      </p>
      <Segmented
        label="Which money in"
        value={show}
        onChange={setShow}
        options={[
          { value: 'review', label: `To review (${toReview})` },
          { value: 'all', label: 'All' },
        ]}
      />
      {!shown.length && (
        <p className="px-1 text-xs text-muted">Nothing to review.</p>
      )}
      {[...byMonth].map(([month, list]) => {
        const totals = months.find((t) => t.month === month)
        return (
          <section
            key={month}
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
            <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span>{monthLabel(month, true)}</span>
              {totals && (
                <span className="tabular-nums normal-case tracking-normal">
                  {dollars(totals.total)} in · {dollars(totals.income)} income
                  {totals.offsets > 0 &&
                    ` · ${dollars(totals.offsets)} offsets`}
                </span>
              )}
            </div>
            <ul className="@container divide-y divide-border">
              {list.map((m) => (
                <MoneyInRow key={m.id} item={m} />
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

function MoneyInRow({ item: m }: { item: MoneyIn }) {
  const { ix } = useBook()
  const file = useFileMoneyIn()
  const owner =
    ix.ledger.accounts.find((a) => a.name === m.account)?.owner ?? 'Joint'
  const label = `${m.store} on ${dayLabel(m.date)}`
  // Choosing Offset waits for a Category before anything is saved.
  const [offsetting, setOffsetting] = useState(false)
  const isOffset = m.use === 'offset' || offsetting

  const save = (use: MoneyInUse, patch: Partial<MoneyIn> = {}) =>
    file.mutate({
      id: m.id,
      use,
      category: patch.category ?? (use === 'offset' ? m.category : null),
      offset: use === 'offset' ? (patch.offset ?? m.offset ?? m.amount) : null,
    })

  return (
    <li className="grid grid-cols-2 items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[13px] @2xl:grid-cols-[3rem_minmax(0,1fr)_5.5rem_7.5rem_minmax(0,1fr)]">
      <span className="hidden text-xs text-muted @2xl:block">
        {dayLabel(m.date)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold">{m.store}</p>
        <p className="truncate text-[11px] text-muted">
          <span className="@2xl:hidden">{dayLabel(m.date)} · </span>
          <span
            className="mr-1 inline-block size-2 rounded-full align-middle"
            style={{ background: ownerColor(owner) }}
            title={owner}
          />
          <AccountRef name={m.account} /> · {m.description}
        </p>
      </div>
      <span className="text-right font-semibold tabular-nums text-accent">
        +{money(m.amount)}
      </span>
      <Dropdown<MoneyInUse>
        value={isOffset ? 'offset' : m.use}
        label={`What ${label} is`}
        edited={m.use === 'review' && !offsetting}
        className="w-full min-w-0"
        onChange={(use) => {
          if (use === 'offset') {
            if (m.use !== 'offset') setOffsetting(true)
            return
          }
          setOffsetting(false)
          if (use !== m.use) save(use)
        }}
        options={MONEY_IN_USES.map((use) => ({
          value: use,
          label: MONEY_IN_LABELS[use],
          hint:
            use === 'offset'
              ? 'comes off a category'
              : use === 'transfer'
                ? 'between our accounts'
                : undefined,
        }))}
      />
      {isOffset ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <CategorySelect
            label={`Category ${label} comes off`}
            value={m.category ?? ''}
            onChange={(category) => {
              setOffsetting(false)
              // "Transfer, not spending" means it isn't an offset at all.
              if (category === TRANSFER) save('transfer')
              else save('offset', { category })
            }}
            className="min-w-0 flex-1"
          />
          {m.use === 'offset' && (
            <input
              key={m.offset ?? m.amount}
              defaultValue={((m.offset ?? m.amount) / 100).toFixed(2)}
              inputMode="decimal"
              aria-label={`How much of ${label} comes off ${m.category}`}
              title="How much comes off (part of it, if the rest was yours)"
              className="field w-20 text-right tabular-nums"
              onBlur={(e) => {
                const cents = parseDollars(e.target.value)
                if (cents === null || cents < 1 || cents > m.amount) {
                  e.target.value = ((m.offset ?? m.amount) / 100).toFixed(2)
                  return
                }
                if (cents !== (m.offset ?? m.amount))
                  save('offset', { offset: cents })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          )}
        </div>
      ) : (
        <NoteInput item={m} label={label} />
      )}
      {m.use === 'offset' && (
        <div className="col-span-full -mt-0.5 text-[11px] text-muted @2xl:col-start-2">
          Takes {money(m.offset ?? m.amount)} off {m.category} in{' '}
          {monthLabel(m.month)}.
        </div>
      )}
    </li>
  )
}

function NoteInput({ item: m, label }: { item: MoneyIn; label: string }) {
  const file = useFileMoneyIn()
  return (
    <input
      type="text"
      key={m.note ?? ''}
      defaultValue={m.note ?? ''}
      maxLength={200}
      placeholder="Add a note"
      aria-label={`Note for ${label}`}
      className={`field w-full min-w-0 ${m.note ? 'has-value' : ''}`}
      onBlur={(e) => {
        const next = e.target.value.trim()
        if (next !== (m.note ?? ''))
          file.mutate({
            id: m.id,
            use: m.use,
            category: m.category,
            offset: m.offset,
            note: next || null,
          })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
