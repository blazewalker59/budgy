import { useEffect, useRef, useState } from 'react'

/**
 * An element's width in px, kept current as it resizes: for drawings laid
 * out in pixels. Starts at `initial` until measured (and on the server).
 */
export function useWidth<T extends HTMLElement = HTMLDivElement>(
  initial = 640,
) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.clientWidth) setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}
