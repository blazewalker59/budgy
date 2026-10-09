import type { Tag } from '@/lib/model/types'
import { TAGS } from '@/lib/model/types'
import { TAG_SHORT } from '@/lib/format'
import { cn } from '@/lib/utils'

export function TagSelect({
  value,
  onChange,
  label,
  allowInherit,
  className,
}: {
  value: Tag | ''
  onChange: (tag: Tag | null) => void
  label: string
  allowInherit?: boolean
  className?: string
}) {
  return (
    <select
      value={value}
      aria-label={label}
      className={cn('field', className)}
      onChange={(e) => onChange((e.target.value || null) as Tag | null)}
    >
      {allowInherit && <option value="">As category</option>}
      {TAGS.map((t) => (
        <option key={t} value={t}>
          {TAG_SHORT[t]}
        </option>
      ))}
    </select>
  )
}
