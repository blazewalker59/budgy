import type { SampleKind } from '@/lib/demo/samples'
import { SAMPLES, sampleCsv } from '@/lib/demo/samples'
import { today } from '@/lib/model/dates'
import { cn } from '@/lib/utils'

/** Made in the browser for today, so the history is always recent. */
export function downloadSample(kind: SampleKind) {
  const sample = SAMPLES.find((s) => s.kind === kind)!
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const blob = new Blob([sampleCsv(kind, today(zone))], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = sample.file
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function SampleDownloads({ compact = false }: { compact?: boolean }) {
  if (compact)
    return (
      <span className="inline-flex items-center gap-1">
        Samples:
        {SAMPLES.map((s) => (
          <button
            key={s.kind}
            type="button"
            onClick={() => downloadSample(s.kind)}
            className="rounded-full px-1.5 font-semibold underline underline-offset-2"
          >
            {s.label.split(' ')[0]}
          </button>
        ))}
      </span>
    )
  return (
    <ul className="space-y-2">
      {SAMPLES.map((s) => (
        <li key={s.kind} className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadSample(s.kind)}
            className={cn(
              'min-h-11 rounded-full border border-border px-3 text-xs font-semibold',
            )}
          >
            Download {s.file}
          </button>
          <span className="text-xs text-muted">
            {s.label}. {s.how}
          </span>
        </li>
      ))}
    </ul>
  )
}
