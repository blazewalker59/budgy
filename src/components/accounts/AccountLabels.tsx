/**
 * An Account's label and "Shown as", in its sheet: pick a label (or make
 * one), and the rest of the name after it is suggested as what it's shown
 * as; other Accounts starting with the label can take it in one go. The
 * Household's labels are renamed, recoloured and deleted here too
 * (docs/adr/0016).
 */

import { useState } from 'react'
import { Check, ChevronDown, Plus, Trash2, X } from 'lucide-react'
import { LABEL_SWATCH, LabelChip, labelStyle, useLabelOf } from './AccountName'
import type { Account, AccountLabel } from '@/lib/model/types'
import type { LabelColor } from '@/lib/model/labels'
import { ConfirmPanel } from '@/components/shared/Confirm'
import { useBook } from '@/lib/ledger/book'
import {
  useAddLabel,
  useChangeLabel,
  useDeleteLabel,
  useLabelAccounts,
  useSaveAccount,
} from '@/lib/ledger/useLedger'
import {
  LABEL_COLORS,
  LABEL_COLOR_KEYS,
  nextColor,
  othersStartingWith,
  suggestShownAs,
} from '@/lib/model/labels'
import { cn } from '@/lib/utils'

type Offer = {
  label: string
  others: Array<{ name: string; displayName: string }>
}

/** The label and "Shown as" of one Account, with the label picker. */
export function LabelFields({ account }: { account: Account }) {
  const { ix } = useBook()
  const saveAccount = useSaveAccount()
  const addLabel = useAddLabel()
  const label = useLabelOf(account)
  const [picking, setPicking] = useState(false)
  const [shown, setShown] = useState(account.displayName ?? '')
  const [offer, setOffer] = useState<Offer | null>(null)

  const save = (patch: Pick<Account, 'label' | 'displayName'>) => {
    const { sourceName: _s, label: _l, displayName: _d, ...rest } = account
    saveAccount.mutate({ ...rest, ...patch, isNew: false })
  }

  const choose = (name: string | null) => {
    setPicking(false)
    if (name === null) {
      save({ label: null })
      setOffer(null)
      return
    }
    const displayName =
      account.displayName || suggestShownAs(account.name, name) || null
    setShown(displayName ?? '')
    save({ label: name, displayName })
    const others = othersStartingWith(ix.ledger.accounts, name, account.name)
    setOffer(others.length ? { label: name, others } : null)
  }

  return (
    <div className="flex basis-full flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-expanded={picking}
        aria-label={label ? `Label: ${label.name}` : 'Label: none'}
        onClick={() => setPicking(!picking)}
        className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-2 font-semibold"
      >
        {label ? (
          <LabelChip label={label} />
        ) : (
          <span className="px-1 text-muted">Label</span>
        )}
        <ChevronDown
          size={13}
          aria-hidden
          className={cn(
            'text-muted transition-transform',
            picking && 'rotate-180',
          )}
        />
      </button>
      <input
        value={shown}
        onChange={(e) => setShown(e.target.value)}
        onBlur={() =>
          shown.trim() !== (account.displayName ?? '') &&
          save({ displayName: shown.trim() || null })
        }
        placeholder={
          (label && suggestShownAs(account.name, label.name)) || 'Shown as'
        }
        title="Shown as, beside the label, on Accounts"
        maxLength={60}
        aria-label="Shown as"
        className="field min-w-24 flex-1"
      />
      {picking && (
        <LabelPicker
          account={account}
          current={label?.name ?? null}
          onChoose={choose}
          onCreate={async (created) => {
            try {
              await addLabel.mutateAsync(created)
              choose(created.name.trim())
            } catch {
              // The save alert already says what went wrong.
            }
          }}
        />
      )}
      {offer && <AlsoLabel offer={offer} onDone={() => setOffer(null)} />}
    </div>
  )
}

/** "Also label 2 other accounts starting with Addie", all at once. */
function AlsoLabel({ offer, onDone }: { offer: Offer; onDone: () => void }) {
  const labelAccounts = useLabelAccounts()
  const n = offer.others.length
  return (
    <div
      role="group"
      aria-label="Label others too"
      className="flex basis-full items-center gap-1.5 rounded-lg bg-sunken px-2 py-1"
    >
      <span className="min-w-0 flex-1 text-muted">
        {offer.others.map((o) => o.name).join(', ')}
      </span>
      <button
        type="button"
        onClick={() => {
          labelAccounts.mutate({ label: offer.label, accounts: offer.others })
          onDone()
        }}
        className="min-h-9 shrink-0 rounded-full bg-foreground px-3 font-semibold text-background"
      >
        Also label {n} other {n === 1 ? 'account' : 'accounts'} starting with{' '}
        {offer.label}
      </button>
      <button
        type="button"
        onClick={onDone}
        aria-label="No thanks"
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}

function LabelPicker({
  account,
  current,
  onChoose,
  onCreate,
}: {
  account: Account
  current: string | null
  onChoose: (name: string | null) => void
  onCreate: (label: AccountLabel) => void
}) {
  const { ix } = useBook()
  const labels = ix.ledger.labels
  const [managing, setManaging] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<LabelColor>(() => nextColor(labels))
  const trimmed = name.trim()
  const taken = labels.some(
    (l) => l.name.toLowerCase() === trimmed.toLowerCase(),
  )
  const hint = account.name
    .trim()
    .split(/\s+/)[0]
    .replace(/['’]s$/i, '')

  if (managing) return <ManageLabels onDone={() => setManaging(false)} />
  return (
    <div className="basis-full space-y-2 rounded-lg border border-border bg-background/40 p-2">
      <div
        role="radiogroup"
        aria-label="Label"
        className="flex flex-wrap gap-1.5"
      >
        {labels.map((l) => (
          <button
            key={l.name}
            type="button"
            role="radio"
            aria-checked={current === l.name}
            onClick={() => onChoose(l.name)}
            className={cn(
              'inline-flex min-h-9 items-center gap-1 rounded-full border px-1.5',
              current === l.name ? 'border-foreground' : 'border-transparent',
            )}
          >
            <LabelChip label={l} className="text-xs" />
            {current === l.name && <Check size={13} aria-hidden />}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          onClick={() => onChoose(null)}
          className={cn(
            'min-h-9 rounded-full border px-3 text-muted',
            current === null ? 'border-foreground' : 'border-border',
          )}
        >
          None
        </button>
      </div>
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!trimmed || taken) return
          onCreate({ name: trimmed, color })
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`New label, e.g. ${hint}`}
          maxLength={30}
          aria-label="New label"
          className="field min-w-32 flex-1"
        />
        <button
          type="submit"
          disabled={!trimmed || taken}
          className="inline-flex min-h-9 items-center gap-1 rounded-full bg-foreground px-3 font-semibold text-background disabled:opacity-40"
        >
          <Plus size={13} aria-hidden /> Add
        </button>
        <Swatches value={color} onChange={setColor} label="New label colour" />
        {taken && (
          <p className="basis-full text-[11px] text-over">
            There’s already a label called {trimmed}.
          </p>
        )}
      </form>
      {labels.length > 0 && (
        <button
          type="button"
          onClick={() => setManaging(true)}
          className="min-h-9 font-semibold text-accent"
        >
          Manage labels
        </button>
      )}
    </div>
  )
}

/** The ten colours, as swatches to choose from. */
function Swatches({
  value,
  onChange,
  label,
}: {
  value: LabelColor
  onChange: (color: LabelColor) => void
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex basis-full flex-wrap"
    >
      {LABEL_COLOR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={LABEL_COLORS[c].name}
          onClick={() => onChange(c)}
          className="grid size-9 place-items-center rounded-full"
          style={labelStyle(c)}
        >
          <span
            className={cn(
              LABEL_SWATCH,
              'size-5',
              value === c &&
                'ring-2 ring-foreground ring-offset-2 ring-offset-surface',
            )}
          />
        </button>
      ))}
    </div>
  )
}

/** Every label: rename, recolour, or delete (asked first). */
function ManageLabels({ onDone }: { onDone: () => void }) {
  const { ix } = useBook()
  return (
    <div className="basis-full space-y-1 rounded-lg border border-border bg-background/40 p-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Labels</h3>
        <button
          type="button"
          onClick={onDone}
          className="min-h-9 px-2 font-semibold text-accent"
        >
          Done
        </button>
      </div>
      <ul className="divide-y divide-border">
        {ix.ledger.labels.map((l) => (
          <ManageRow
            key={l.name}
            label={l}
            uses={ix.ledger.accounts.filter((a) => a.label === l.name)}
          />
        ))}
      </ul>
    </div>
  )
}

function ManageRow({
  label,
  uses,
}: {
  label: AccountLabel
  uses: Array<Account>
}) {
  const { ix } = useBook()
  const changeLabel = useChangeLabel()
  const deleteLabel = useDeleteLabel()
  const [name, setName] = useState(label.name)
  const [colors, setColors] = useState(false)
  const [asking, setAsking] = useState(false)
  const trimmed = name.trim()
  const taken = ix.ledger.labels.some(
    (l) =>
      l.name !== label.name && l.name.toLowerCase() === trimmed.toLowerCase(),
  )
  const change = (next: AccountLabel) =>
    changeLabel.mutate({ from: label.name, ...next })
  const n = uses.length
  return (
    <li className="space-y-1 py-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-expanded={colors}
          aria-label={`${label.name}’s colour: ${LABEL_COLORS[label.color].name}`}
          onClick={() => setColors(!colors)}
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={labelStyle(label.color)}
        >
          <span className={cn(LABEL_SWATCH, 'size-5')} />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (!trimmed || taken) setName(label.name)
            else if (trimmed !== label.name)
              change({ name: trimmed, color: label.color })
          }}
          maxLength={30}
          aria-label={`Rename ${label.name}`}
          className="field min-w-0 flex-1"
        />
        <span className="shrink-0 text-[11px] text-muted">
          {n} {n === 1 ? 'account' : 'accounts'}
        </span>
        <button
          type="button"
          onClick={() => setAsking(true)}
          aria-label={`Delete ${label.name}`}
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:text-over"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      {taken && (
        <p className="text-[11px] text-over">
          There’s already a label called {trimmed}.
        </p>
      )}
      {colors && (
        <Swatches
          value={label.color}
          onChange={(color) => {
            change({ name: label.name, color })
            setColors(false)
          }}
          label={`${label.name}’s colour`}
        />
      )}
      {asking && (
        <ConfirmPanel
          question={`Delete the label ${label.name}?`}
          detail={
            n
              ? `${n} ${n === 1 ? 'account uses' : 'accounts use'} it (${uses.map((a) => a.name).join(', ')}). They keep what they’re shown as.`
              : 'No account uses it.'
          }
          action="Delete"
          onConfirm={() => {
            deleteLabel.mutate({ name: label.name })
            setAsking(false)
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </li>
  )
}
