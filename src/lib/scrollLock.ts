/**
 * Holding the page still under a sheet or the command palette. iOS Safari
 * ignores `overflow: hidden` on the body for touch scrolling, so the body
 * is pinned in place (position: fixed at the current offset) and put back
 * where it was on release. Counted, so a sheet opened from a sheet keeps
 * the page locked until the last one closes.
 */

let holders = 0
let saved: { y: number; style: string } | null = null

export function lockScroll(): () => void {
  if (holders++ === 0) {
    const body = document.body
    saved = { y: window.scrollY, style: body.getAttribute('style') ?? '' }
    Object.assign(body.style, {
      position: 'fixed',
      top: `-${saved.y}px`,
      left: '0',
      right: '0',
      width: '100%',
      overflow: 'hidden',
    })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--holders > 0 || !saved) return
    const { y, style } = saved
    saved = null
    document.body.setAttribute('style', style)
    window.scrollTo({ top: y, behavior: 'instant' })
  }
}
