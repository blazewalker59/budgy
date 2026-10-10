import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Dropdown } from './Dropdown'
import { monthLabel, shiftMonth } from '@/lib/model/dates'

export function MonthPicker({
  month,
  months,
  onChange,
}: {
  month: string
  /** Months to offer, oldest first. */
  months: Array<string>
  onChange: (month: string) => void
}) {
  const first = months[0] ?? month
  const last = months[months.length - 1] ?? month
  return (
    <div className="flex items-center">
      <button
        type="button"
        aria-label="Previous month"
        disabled={month <= first}
        onClick={() => onChange(shiftMonth(month, -1))}
        className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-foreground disabled:opacity-30"
      >
        <ChevronLeft size={18} aria-hidden />
      </button>
      <Dropdown
        value={month}
        onChange={onChange}
        label="Month"
        className="h-8 min-h-0 w-auto rounded-lg border-0 bg-transparent px-1 text-lg font-extrabold tracking-tight shadow-none hover:bg-sunken pointer-coarse:min-h-8 pointer-coarse:text-lg"
        options={[...months]
          .reverse()
          .map((m) => ({ value: m, label: monthLabel(m, true) }))}
      />
      <button
        type="button"
        aria-label="Next month"
        disabled={month >= last}
        onClick={() => onChange(shiftMonth(month, 1))}
        className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-foreground disabled:opacity-30"
      >
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
  )
}
