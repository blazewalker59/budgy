import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'

/** Drag further than this (px), or flick faster than FLICK, to dismiss. */
const DISMISS_PX = 110
const FLICK_PX_PER_MS = 0.6
const EXIT_MS = 220

/** Open sheets, newest last: Escape closes only the top one. */
const open: Array<symbol> = []

/**
 * A bottom sheet (the same as sportsline's), so drilling into a number
 * never leaves the screen: closing lands exactly where you were. Swipe it
 * down (from the handle or header, or from the content when it is
 * scrolled to the top) to dismiss, like a native sheet.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const close = useRef<HTMLButtonElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const gesture = useRef<{
    startY: number
    startT: number
    active: boolean
  } | null>(null)

  const dismiss = useCallback(() => {
    setLeaving(true)
    setTimeout(onClose, EXIT_MS)
  }, [onClose])

  useEffect(() => {
    const me = Symbol('sheet')
    open.push(me)
    close.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) =>
      e.key === 'Escape' && open.at(-1) === me && dismiss()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      open.splice(open.indexOf(me), 1)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [dismiss])

  const onTouchStart = (e: React.TouchEvent, fromContent: boolean) => {
    // A sheet opened from this one is its child in React: keep its swipes.
    e.stopPropagation()
    // From the content, only when it can't scroll up any further.
    if (fromContent && (body.current?.scrollTop ?? 0) > 0) return
    gesture.current = {
      startY: e.touches[0].clientY,
      startT: performance.now(),
      active: true,
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation()
    const g = gesture.current
    if (!g?.active) return
    const dy = e.touches[0].clientY - g.startY
    if (dy <= 0) {
      setDrag(0)
      return
    }
    setDrag(dy)
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation()
    const g = gesture.current
    gesture.current = null
    if (!g?.active) return
    const velocity = drag / Math.max(1, performance.now() - g.startT)
    if (drag > DISMISS_PX || velocity > FLICK_PX_PER_MS) dismiss()
    else setDrag(0)
  }

  const dragging = gesture.current?.active && drag > 0
  // On the body, so a sheet opened from another sheet isn't laid out
  // inside it (the sheet's transform would trap a fixed child).
  const portal = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
  const sheet = (
    <div
      className="fixed inset-0 z-30 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label={`Close ${title.toLowerCase()}`}
        onClick={dismiss}
        className="animate-in fade-in absolute inset-0 bg-black/40 transition-opacity duration-200"
        style={{ opacity: leaving ? 0 : Math.max(0.2, 1 - drag / 400) }}
      />
      <div
        className="animate-in slide-in-from-bottom relative mx-auto flex max-h-[calc(100dvh-max(env(safe-area-inset-top),1.5rem))] w-full max-w-xl flex-col rounded-t-3xl bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl duration-300"
        style={{
          transform: leaving ? 'translateY(100%)' : `translateY(${drag}px)`,
          transition: dragging
            ? 'none'
            : `transform ${EXIT_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
        }}
      >
        <div
          className="touch-none"
          onTouchStart={(e) => onTouchStart(e, false)}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <div className="flex justify-center pt-2 pb-1" aria-hidden="true">
            <span className="h-1.5 w-10 rounded-full bg-muted/40" />
          </div>
          <div className="flex items-center gap-3 border-b border-border px-4 pb-3">
            <span className="flex-1 text-base font-bold">{title}</span>
            <button
              ref={close}
              type="button"
              onClick={dismiss}
              className="min-h-11 rounded-full bg-sunken px-4 text-[13px] font-semibold"
            >
              Done
            </button>
          </div>
        </div>
        <div
          ref={body}
          className="flex flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4 [&>*]:shrink-0"
          onTouchStart={(e) => onTouchStart(e, true)}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          {children}
        </div>
      </div>
    </div>
  )
  return portal ? createPortal(sheet, document.body) : sheet
}

const noSubscribe = () => () => {}
