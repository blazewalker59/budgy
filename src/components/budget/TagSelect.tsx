import type { Tag } from '@/lib/model/types'
import { TAGS } from '@/lib/model/types'
import { TAG_SHORT } from '@/lib/format'
import { Dropdown } from '@/components/shared/Dropdown'

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
    <Dropdown
      value={value}
      label={label}
      className={className}
      onChange={(t) => onChange(t || null)}
      options={[
        ...(allowInherit ? [{ value: '' as const, label: 'As category' }] : []),
        ...TAGS.map((t) => ({ value: t, label: TAG_SHORT[t] })),
      ]}
    />
  )
}
