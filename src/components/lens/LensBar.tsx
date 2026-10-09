/**
 * The Lens under the top bar: each filter as a chip to remove, + Filter
 * (the palette), Save (the Lens under a name, found again in the palette)
 * and Clear. Filters this screen doesn't use stay, faded, for the screens
 * that do.
 */

import { useState } from 'react'
import { Plus, Star, X } from 'lucide-react'
import type { LensFilter } from '@/lib/model/lens'
import type { LensPage } from '@/lib/ledger/useLens'
import { useBook } from '@/lib/ledger/book'
import { honors, openPalette, useLens } from '@/lib/ledger/useLens'
import { newLensId, useDeleteLens, useSaveLens } from '@/lib/ledger/useLedger'
import {
  filterKey,
  filterLabel,
  filtersOf,
  withoutFilter,
} from '@/lib/model/lens'
import { TAG_BG, ownerColor } from '@/lib/format'
import { cn } from '@/lib/utils'

export function LensChip({
  filter: f,
  faded,
  onRemove,
}: {
  filter: LensFilter
  faded?: boolean
  onRemove?: () => void
}) {
  const [kind, value] = filterLabel(f)
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-sunken py-0.5 pl-2 text-xs font-semibold',
        onRemove ? 'pr-0.5' : 'pr-2',
        faded && 'opacity-50',
      )}
      title={faded ? 'Not used on this screen; kept for the others' : undefined}
    >
      {f.type === 'person' && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: ownerColor(f.value) }}
        />
      )}
      {f.type === 'tag' && (
        <span className={cn('size-2 shrink-0 rounded-full', TAG_BG[f.value])} />
      )}
      <span className="shrink-0 text-[10px] font-semibold text-muted">
        {kind}
      </span>
      <span className="truncate">{value}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${kind.toLowerCase()} ${value}`}
          className="rounded-full p-0.5 text-muted hover:bg-surface hover:text-over"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
  )
}

/** Two Lenses are the same when they hold the same filters. */
function sameLens(a: object, b: object): boolean {
  const norm = (o: object) =>
    JSON.stringify(
      Object.entries(o)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])
        .sort(),
    )
  return norm(a) === norm(b)
}

export function LensBar({
  page,
  note,
  children,
}: {
  page: LensPage
  /** What this screen does with the Lens, when it isn't everything. */
  note?: string
  /** Screen controls on the right (a period switch). */
  children?: React.ReactNode
}) {
  const { ix } = useBook()
  const { lens, show, empty } = useLens()
  const saveLens = useSaveLens()
  const deleteLens = useDeleteLens()
  const [naming, setNaming] = useState<string | null>(null)
  const [forget, setForget] = useState(false)
  const saved = ix.ledger.lenses.find((l) => sameLens(l.lens, lens))
  const filters = filtersOf(lens)

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-1.5">
      {filters.map((f) => (
        <LensChip
          key={filterKey(f)}
          filter={f}
          faded={!honors(page, f)}
          onRemove={() => show(withoutFilter(lens, f))}
        />
      ))}
      <button
        type="button"
        onClick={() => openPalette()}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-semibold text-accent hover:border-accent"
      >
        <Plus size={12} aria-hidden /> Filter
        <kbd className="ml-0.5 hidden rounded border border-border px-1 font-sans text-[10px] text-muted sm:inline">
          /
        </kbd>
      </button>
      {!empty &&
        (saved ? (
          <button
            type="button"
            onClick={() => {
              if (!forget) return setForget(true)
              deleteLens.mutate({ id: saved.id })
              setForget(false)
            }}
            onBlur={() => setForget(false)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
              forget ? 'text-over' : 'text-planned',
            )}
            title="Saved lens; tap twice to forget it"
          >
            <Star size={12} className="fill-current" aria-hidden />
            {forget ? `Forget “${saved.name}”?` : saved.name}
          </button>
        ) : naming === null ? (
          <button
            type="button"
            onClick={() => setNaming('')}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-muted hover:text-foreground"
          >
            <Star size={12} aria-hidden /> Save
          </button>
        ) : (
          <form
            className="inline-flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              const name = naming.trim()
              if (!name) return
              saveLens.mutate({ id: newLensId(), name, lens })
              setNaming(null)
            }}
          >
            <input
              autoFocus
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
              maxLength={40}
              placeholder="Name this lens"
              aria-label="Name this lens"
              className="field w-36 py-0.5 text-xs"
            />
            <button
              type="submit"
              disabled={!naming.trim()}
              className="rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background disabled:opacity-40"
            >
              Save
            </button>
          </form>
        ))}
      {!empty && (
        <button
          type="button"
          onClick={() => show({})}
          className="rounded-full px-2 py-0.5 text-xs font-semibold text-muted hover:text-over"
        >
          Clear
        </button>
      )}
      {note && <span className="text-[11px] text-muted">{note}</span>}
      {children && <div className="ml-auto">{children}</div>}
    </div>
  )
}
