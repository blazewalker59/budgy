/** A value to paste somewhere else (a token, a URL), with a copy button. */
import { useState } from 'react'
import { Copy } from 'lucide-react'

export function CopyLine({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-1.5">
      <code className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1.5 font-mono text-[11px] break-all whitespace-pre-wrap">
        {text}
      </code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-foreground"
      >
        {copied ? (
          <span className="text-[10px] font-bold">✓</span>
        ) : (
          <Copy size={13} />
        )}
      </button>
    </div>
  )
}
