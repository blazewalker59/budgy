import { useState } from 'react'
import { useBook } from '@/lib/ledger/book'
import { allCategoryNames } from '@/lib/model/ledger'
import { cn } from '@/lib/utils'

const NEW = '__new'

/** Pick a Category, or type a new one. */
export function CategorySelect({
  value,
  defaultValue,
  onChange,
  label,
  className,
}: {
  value: string
  /** Where it goes without a Move; marked "(store's)". */
  defaultValue?: string
  onChange: (category: string) => void
  label: string
  className?: string
}) {
  const { ix } = useBook()
  const [adding, setAdding] = useState(false)
  if (adding)
    return (
      <input
        autoFocus
        aria-label={`New category for ${label}`}
        placeholder="New category"
        maxLength={60}
        className={cn('field', className)}
        onBlur={(e) => {
          const name = e.target.value.trim()
          if (name) onChange(name)
          setAdding(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setAdding(false)
        }}
      />
    )
  const names = allCategoryNames(ix)
  return (
    <select
      value={value}
      aria-label={label}
      className={cn(
        'field',
        value !== defaultValue && defaultValue && 'has-value',
        className,
      )}
      onChange={(e) =>
        e.target.value === NEW ? setAdding(true) : onChange(e.target.value)
      }
    >
      {!value && (
        <option value="" disabled>
          Choose a category
        </option>
      )}
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
          {n === defaultValue && value !== defaultValue ? ' (usual)' : ''}
        </option>
      ))}
      <option value={NEW}>New category…</option>
    </select>
  )
}
