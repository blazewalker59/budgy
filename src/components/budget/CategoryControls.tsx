/**
 * Renaming, hiding and deleting one Category, in place. A Category in use
 * can be hidden, never deleted, so its history stays where it was.
 */
import { useState } from 'react'
import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react'
import { useBook } from '@/lib/ledger/book'
import {
  useDeleteCategory,
  useHideCategory,
  useRenameCategory,
} from '@/lib/ledger/useLedger'
import { categoryUseCount, isHidden } from '@/lib/model/categories'
import { ConfirmPanel } from '@/components/shared/Confirm'

export function CategoryControls({
  name,
  onRenamed,
  onDeleted,
}: {
  name: string
  onRenamed?: (to: string) => void
  onDeleted?: () => void
}) {
  const { ix } = useBook()
  const rename = useRenameCategory()
  const hide = useHideCategory()
  const remove = useDeleteCategory()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const hidden = isHidden(ix, name)
  const unused = categoryUseCount(ix.ledger, name) === 0
  const taken = (to: string) =>
    to.toLowerCase() !== name.toLowerCase() &&
    [...ix.categories.keys()].some((c) => c.toLowerCase() === to.toLowerCase())

  if (editing)
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          const input = e.currentTarget.elements.namedItem(
            'name',
          ) as HTMLInputElement
          const to = input.value.trim()
          if (!to || to === name) return setEditing(false)
          if (taken(to)) {
            input.setCustomValidity(`There’s already a category called ${to}.`)
            input.reportValidity()
            return
          }
          rename.mutate({ from: name, to })
          setEditing(false)
          onRenamed?.(to)
        }}
      >
        <input
          name="name"
          autoFocus
          defaultValue={name}
          maxLength={60}
          aria-label={`New name for ${name}`}
          onChange={(e) => e.target.setCustomValidity('')}
          className="field min-h-11 min-w-40 flex-1"
        />
        <button
          type="submit"
          className="min-h-11 rounded-full bg-foreground px-3 text-xs font-semibold text-background"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="min-h-11 rounded-full px-3 text-xs font-semibold"
        >
          Cancel
        </button>
      </form>
    )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Rename ${name}`}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-xs font-semibold"
        >
          <Pencil size={13} aria-hidden /> Rename
        </button>
        <button
          type="button"
          onClick={() => hide.mutate({ name, hidden: !hidden })}
          aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border px-3 text-xs font-semibold"
        >
          {hidden ? (
            <>
              <Eye size={13} aria-hidden /> Show
            </>
          ) : (
            <>
              <EyeOff size={13} aria-hidden /> Hide
            </>
          )}
        </button>
        {unused && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${name}`}
            className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-semibold text-over"
          >
            <Trash2 size={13} aria-hidden /> Delete
          </button>
        )}
      </div>
      {confirming && (
        <ConfirmPanel
          question={`Delete ${name}?`}
          detail="Nothing is filed there yet."
          action="Delete"
          onConfirm={() => {
            setConfirming(false)
            remove.mutate({ name })
            onDeleted?.()
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {hidden && (
        <p className="text-xs text-muted">
          Hidden from pickers and the Budget. Its purchases still count.
        </p>
      )}
    </div>
  )
}
