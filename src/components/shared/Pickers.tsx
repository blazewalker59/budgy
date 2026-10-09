import { ChevronLeft, ChevronRight } from 'lucide-react'
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
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Previous month"
        disabled={month <= first}
        onClick={() => onChange(shiftMonth(month, -1))}
        className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface disabled:opacity-30"
      >
        <ChevronLeft size={18} aria-hidden />
      </button>
      <select
        value={month}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Month"
        className="field min-w-36 font-semibold"
      >
        {[...months].reverse().map((m) => (
          <option key={m} value={m}>
            {monthLabel(m, true)}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Next month"
        disabled={month >= last}
        onClick={() => onChange(shiftMonth(month, 1))}
        className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface disabled:opacity-30"
      >
        <ChevronRight size={18} aria-hidden />
      </button>
    </div>
  )
}
