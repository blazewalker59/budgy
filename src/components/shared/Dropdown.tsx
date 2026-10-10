import { useState, useSyncExternalStore } from 'react'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { Sheet } from './Sheet'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  triggerClass,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface Option<T extends string> {
  value: T
  label: string
  /** Muted after the label, in the list only (why it's disabled, say). */
  hint?: string
  disabled?: boolean
}

export interface OptionGroup<T extends string> {
  group: string
  options: Array<Option<T>>
}

/** Radix keeps '' for "nothing chosen", so a real '' option goes by this. */
const EMPTY = '__empty'

/**
 * Pick one of a few options. With a mouse, a list drops from the trigger
 * (shadcn's Select); on a touch screen the trigger opens a bottom sheet of
 * full-width rows instead, like the app's other sheets. `label` names it
 * for screen readers and titles the sheet.
 */
export function Dropdown<T extends string>({
  value,
  onChange,
  options,
  label,
  placeholder = 'Choose…',
  disabled,
  edited,
  className,
}: {
  /** '' with no '' option shows the placeholder. */
  value: T | ''
  onChange: (value: T) => void
  options: Array<Option<T> | OptionGroup<T>>
  label: string
  placeholder?: string
  disabled?: boolean
  /** Changed from its usual: the Planned color, like `.field.has-value`. */
  edited?: boolean
  className?: string
}) {
  const touch = useSyncExternalStore(onPointerChange, isCoarse, () => false)
  const flat = options.flatMap((o) => ('group' in o ? o.options : [o]))
  const chosen = flat.find((o) => o.value === value)

  if (touch)
    return (
      <SheetDropdown
        {...{ value, onChange, options, label, disabled, edited, className }}
        chosen={chosen}
        placeholder={placeholder}
      />
    )

  const item = (o: Option<T>) => (
    <SelectItem
      key={o.value}
      value={o.value || EMPTY}
      disabled={o.disabled}
      hint={o.hint}
    >
      {o.label}
    </SelectItem>
  )
  return (
    <Select
      value={chosen ? chosen.value || EMPTY : ''}
      onValueChange={(v) => onChange((v === EMPTY ? '' : v) as T)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        data-edited={edited || undefined}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) =>
          'group' in o ? (
            <SelectGroup key={o.group}>
              <SelectLabel>{o.group}</SelectLabel>
              {o.options.map(item)}
            </SelectGroup>
          ) : (
            item(o)
          ),
        )}
      </SelectContent>
    </Select>
  )
}

function SheetDropdown<T extends string>({
  value,
  onChange,
  options,
  label,
  placeholder,
  chosen,
  disabled,
  edited,
  className,
}: {
  value: T | ''
  onChange: (value: T) => void
  options: Array<Option<T> | OptionGroup<T>>
  label: string
  placeholder: string
  chosen: Option<T> | undefined
  disabled?: boolean
  edited?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rows = (list: Array<Option<T>>, close: () => void) => (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {list.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={on}
            disabled={o.disabled}
            onClick={() => {
              if (!on) onChange(o.value)
              close()
            }}
            className="flex min-h-12 w-full items-center gap-3 border-b border-border px-4 text-left text-base last:border-b-0 active:bg-accent-soft disabled:opacity-45"
          >
            <span className={cn('min-w-0 flex-1', on && 'font-semibold')}>
              {o.label}
              {o.hint && (
                <span className="ml-1.5 text-sm text-muted">{o.hint}</span>
              )}
            </span>
            {on && <CheckIcon className="size-5 shrink-0 text-accent" />}
          </button>
        )
      })}
    </div>
  )
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        data-state={open ? 'open' : 'closed'}
        data-placeholder={chosen ? undefined : ''}
        data-edited={edited || undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(triggerClass, className)}
      >
        <span className="truncate">{chosen?.label ?? placeholder}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted" />
      </button>
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          {(close) => (
            <div
              role="listbox"
              aria-label={label}
              className="flex flex-col gap-4"
            >
              {options.some((o) => !('group' in o)) &&
                rows(
                  options.filter((o): o is Option<T> => !('group' in o)),
                  close,
                )}
              {options
                .filter((o): o is OptionGroup<T> => 'group' in o)
                .map((g) => (
                  <section key={g.group} className="flex flex-col gap-1.5">
                    <h3 className="px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {g.group}
                    </h3>
                    {rows(g.options, close)}
                  </section>
                ))}
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}

const COARSE = '(pointer: coarse)'
// Not every window has matchMedia (jsdom): a mouse, then.
const isCoarse = () => window.matchMedia?.(COARSE).matches ?? false
function onPointerChange(change: () => void) {
  const q = window.matchMedia?.(COARSE)
  q?.addEventListener('change', change)
  return () => q?.removeEventListener('change', change)
}
