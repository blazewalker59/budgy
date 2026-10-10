/**
 * A light buzz under the finger, so the installed app (src/lib/pwa.ts)
 * feels native on a phone. Android has the Vibration API; iOS Safari has
 * none, but ticks when a switch (`<input type="checkbox" switch>`, iOS 18+)
 * is toggled by its label, so a hidden one is clicked instead: one tick per
 * buzz there. Touch screens only, and only during a tap or gesture.
 */

import { useEffect } from 'react'

export type Haptic = 'tap' | 'select' | 'success' | 'warning' | 'error'

/** Android: milliseconds of buzz, then pause, then buzz… */
const PATTERNS: Record<Haptic, number | Array<number>> = {
  tap: 8,
  select: 5,
  success: [10, 60, 14],
  warning: [18, 90, 18],
  error: [20, 60, 20, 60, 24],
}

/** iOS: ticks, TICK_MS apart. */
const TICKS: Record<Haptic, number> = {
  tap: 1,
  select: 1,
  success: 2,
  warning: 2,
  error: 3,
}
const TICK_MS = 90

/** A second buzz this soon after one is the same tap (a label and its input). */
const SAME_TAP_MS = 50

let last = 0
let iosSwitch: HTMLLabelElement | null = null

const touch = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches

function tick(): void {
  if (!iosSwitch) {
    iosSwitch = document.createElement('label')
    iosSwitch.setAttribute('aria-hidden', 'true')
    iosSwitch.dataset.haptic = 'off'
    iosSwitch.style.cssText =
      'position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('switch', '')
    input.tabIndex = -1
    iosSwitch.appendChild(input)
    document.body.appendChild(iosSwitch)
  }
  iosSwitch.click()
}

export function haptic(kind: Haptic = 'tap'): void {
  if (!touch()) return
  const now = performance.now()
  if (now - last < SAME_TAP_MS) return
  last = now
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(PATTERNS[kind])
    } catch {
      // Blocked (no tap yet, or turned off): nothing to feel.
    }
    return
  }
  tick()
  for (let i = 1; i < TICKS[kind]; i++) setTimeout(tick, i * TICK_MS)
}

/** What a tap on this element feels like; null for nothing. */
export function feel(target: EventTarget | null): Haptic | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>(
    'button, a[href], summary, label, input[type="checkbox"], input[type="radio"], [role="button"], [role="option"], [role="tab"], [role="menuitem"], [role="switch"]',
  )
  if (!el || el.matches(':disabled, [aria-disabled="true"]')) return null
  const set = el.closest<HTMLElement>('[data-haptic]')?.dataset.haptic
  if (set === 'off') return null
  if (set && set in PATTERNS) return set as Haptic
  return el.matches(
    '[role="option"], [role="tab"], [role="switch"], input, label',
  )
    ? 'select'
    : 'tap'
}

/**
 * Every tap on something tappable buzzes, from one listener; an element
 * (or one around it) can ask for another feel with `data-haptic` (say,
 * "warning" on Delete) or none with `data-haptic="off"`.
 */
export function useHaptics(): void {
  useEffect(() => {
    if (!touch()) return
    const onClick = (e: MouseEvent) => {
      // Our own switch's clicks, and other scripted ones, aren't taps.
      if (!e.isTrusted) return
      const kind = feel(e.target)
      if (kind) haptic(kind)
    }
    document.addEventListener('click', onClick, { capture: true })
    return () =>
      document.removeEventListener('click', onClick, { capture: true })
  }, [])
}
