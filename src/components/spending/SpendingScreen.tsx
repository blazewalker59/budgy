/**
 * Every Transaction, searchable: find the thermostat, Move it, note why.
 */

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useBook } from '@/lib/ledger/book'
import { allCategoryNames, categoryOf, ownerOf } from '@/lib/model/ledger'
import { monthLabel } from '@/lib/model/dates'
import { dollars } from '@/lib/model/money'
import { OwnerPicker } from '@/components/shared/Pickers'
import { TxnList } from '@/components/shared/TxnList'

export function SpendingScreen() {
  const { ix, months } = useBook()
  const [q, setQ] = useState('')
  const [month, setMonth] = useState('')
  const [category, setCategory] = useState('')
  const [owner, setOwner] = useState<string | undefined>()
  const [onlyNoted, setOnlyNoted] = useState(false)

  const txns = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return ix.ledger.txns
      .filter(
        (t) =>
          (!month || t.month === month) &&
          (!category || categoryOf(ix, t) === category) &&
          (!owner || ownerOf(ix, t) === owner) &&
          (!onlyNoted || t.note || t.category) &&
          (!needle ||
            t.store.toLowerCase().includes(needle) ||
            t.description.toLowerCase().includes(needle) ||
            (t.note ?? '').toLowerCase().includes(needle)),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)
  }, [ix, q, month, category, owner, onlyNoted])
  const total = txns.reduce((n, t) => n + t.amount, 0)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold tracking-tight">Spending</h1>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search
            size={16}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Store, description or note"
            aria-label="Search purchases"
            className="field w-full pl-8"
          />
        </label>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Month"
          className="field"
        >
          <option value="">Every month</option>
          {[...months].reverse().map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
          className="field"
        >
          <option value="">Every category</option>
          {allCategoryNames(ix).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <OwnerPicker owner={owner} onChange={setOwner} />
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={onlyNoted}
            onChange={(e) => setOnlyNoted(e.target.checked)}
          />
          Moved or noted
        </label>
      </div>
      <p className="text-sm text-muted">
        {txns.length} purchase{txns.length === 1 ? '' : 's'} ·{' '}
        <span className="font-semibold text-foreground">{dollars(total)}</span>
      </p>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <TxnList txns={txns} limit={150} />
      </div>
    </div>
  )
}
