/**
 * Asking in place before something that can't be undone: what will happen,
 * then the action (in red) or Cancel. Shown where its button was.
 */
export function ConfirmPanel({
  question,
  detail,
  action,
  onConfirm,
  onCancel,
}: {
  question: string
  detail?: string
  action: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="alertdialog"
      aria-label={question}
      className="space-y-2 rounded-lg border border-over/40 bg-over-soft p-3 text-[13px] text-foreground"
    >
      <p>
        <strong>{question}</strong>
        {detail && ` ${detail}`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-9 rounded-full bg-over px-4 font-semibold text-surface"
        >
          {action}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-9 rounded-full bg-surface px-4 font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
