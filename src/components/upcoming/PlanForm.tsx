/** Adding a Plan, or changing one from its sheet. */

import { useMemo, useState } from 'react'
import type { Plan } from '@/lib/model/types'
import { useBook } from '@/lib/ledger/book'
import { useSavePlan } from '@/lib/ledger/useLedger'
import { setAside as isSetAside } from '@/lib/model/plans'
import { parseDollars } from '@/lib/model/money'
import { CADENCES, CADENCE_LABELS } from '@/lib/model/types'
import { CategorySelect } from '@/components/shared/CategorySelect'
import { Dropdown } from '@/components/shared/Dropdown'

/** A Plan's settings, to add one or (in its sheet) change it. */
export function PlanForm({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const { ix } = useBook()
  const save = useSavePlan()
  const [draft, setDraft] = useState(plan)
  const [amount, setAmount] = useState(
    plan.amount ? String(plan.amount / 100) : '',
  )
  const stores = useMemo(
    () => [...new Set(ix.ledger.txns.map((t) => t.store))].sort(),
    [ix],
  )
  const cents = parseDollars(amount)
  const valid = draft.name.trim() && cents && cents > 0
  return (
    <form
      className="mb-1 grid gap-3 rounded-xl border-2 border-planned/40 bg-surface p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        save.mutate({
          ...draft,
          name: draft.name.trim(),
          store: draft.store?.trim() || null,
          amount: cents,
        })
        onDone()
      }}
    >
      <Field label="Name">
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Car insurance"
          maxLength={60}
          className="field w-full"
        />
      </Field>
      <Field label="Category">
        <CategorySelect
          label="Category"
          value={draft.category}
          onChange={(category) => setDraft({ ...draft, category })}
          className="w-full"
        />
      </Field>
      <Field label="Amount">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="1,250"
          className="field w-full"
        />
      </Field>
      <Field label="How often">
        <Dropdown<Plan['cadence']>
          value={draft.cadence}
          onChange={(cadence) => setDraft({ ...draft, cadence })}
          label="How often"
          className="w-full"
          options={CADENCES.map((c) => ({
            value: c,
            label: CADENCE_LABELS[c],
          }))}
        />
        <span className="mt-1 block text-xs text-muted">
          {isSetAside(draft)
            ? 'Kept out of targets, budgeted on its due dates.'
            : 'Counts toward the category’s target.'}
        </span>
      </Field>
      <Field label="Next due">
        <input
          type="date"
          value={draft.anchor}
          onChange={(e) =>
            e.target.value && setDraft({ ...draft, anchor: e.target.value })
          }
          className="field w-full"
        />
      </Field>
      <Field label="Paid to (optional)">
        <input
          list="plan-stores"
          value={draft.store ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, store: e.target.value || null })
          }
          placeholder="Any store, matched by amount"
          className="field w-full"
        />
        <datalist id="plan-stores">
          {stores.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={onDone}
          className="min-h-9 rounded-full px-4 text-sm font-medium text-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="min-h-9 rounded-full bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}
