import { useState } from 'react'
import { useBook } from '@/lib/ledger/book'
import { TRANSFER, allCategoryNames } from '@/lib/model/ledger'
import { cn } from '@/lib/utils'
import { Dropdown } from '@/components/shared/Dropdown'

const NEW = '__new'

/** Pick a Category (or Transfer), or type a new one. */
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
  // Its usual Category, even when nothing else is filed there.
  const names = new Set(allCategoryNames(ix))
  if (defaultValue && defaultValue !== TRANSFER) names.add(defaultValue)
  const usual = (n: string) =>
    n === defaultValue && value !== defaultValue ? 'usual' : undefined
  return (
    <Dropdown
      value={value}
      label={label}
      placeholder="Choose a category"
      edited={!!defaultValue && value !== defaultValue}
      className={className}
      onChange={(c) => (c === NEW ? setAdding(true) : onChange(c))}
      options={[
        ...[...names]
          .sort((a, b) => a.localeCompare(b))
          .map((n) => ({
            value: n,
            label: n,
            hint: usual(n),
          })),
        {
          value: TRANSFER,
          label: 'Transfer, not spending',
          hint: usual(TRANSFER),
        },
        { value: NEW, label: 'New category…' },
      ]}
    />
  )
}
