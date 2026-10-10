/** A value to paste somewhere else (a token, a URL), with a copy button. */
import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyLine({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle')
  const code = useRef<HTMLElement>(null)
  // If the clipboard is refused (some in-app browsers), select the text so
  // the system Copy menu is one tap away.
  function selectText() {
    const selection = window.getSelection()
    if (!code.current || !selection) return
    const range = document.createRange()
    range.selectNodeContents(code.current)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return (
    <div className="space-y-1">
      <div className="flex items-stretch gap-1.5">
        <code
          ref={code}
          className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1.5 font-mono text-[11px] break-all whitespace-pre-wrap select-all"
        >
          {text}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => {
                setState('copied')
                setTimeout(() => setState('idle'), 2000)
              })
              .catch(() => {
                selectText()
                setState('select')
              })
          }
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs font-semibold hover:bg-sunken"
        >
          {state === 'copied' ? (
            <Check size={14} aria-hidden />
          ) : (
            <Copy size={14} aria-hidden />
          )}
          {state === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {state === 'select' && (
        <p role="status" className="text-[11px] text-muted">
          Selected: use your device’s Copy.
        </p>
      )}
    </div>
  )
}
