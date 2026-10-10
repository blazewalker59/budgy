// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { feel, haptic } from '@/lib/haptics'

const coarse = (matches: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }))

let now = 0
beforeEach(() => {
  now += 1000
  vi.spyOn(performance, 'now').mockReturnValue(now)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  delete (navigator as { vibrate?: unknown }).vibrate
})

const html = (markup: string) => {
  document.body.innerHTML = markup
  return document.body.firstElementChild!
}

describe('haptics', () => {
  it('buzzes a pattern where the phone can vibrate', () => {
    coarse(true)
    const vibrate = vi.fn()
    Object.assign(navigator, { vibrate })
    haptic('success')
    expect(vibrate).toHaveBeenCalledWith([10, 60, 14])
  })

  it('counts a second buzz in the same moment as the same tap', () => {
    coarse(true)
    const vibrate = vi.fn()
    Object.assign(navigator, { vibrate })
    haptic()
    haptic()
    expect(vibrate).toHaveBeenCalledTimes(1)
  })

  it('ticks a hidden switch on iOS, which has no vibrate', () => {
    coarse(true)
    haptic()
    const label = document.querySelector('label[data-haptic="off"]')!
    expect(label.querySelector('input[switch]')).not.toBeNull()
    expect((label.querySelector('input') as HTMLInputElement).checked).toBe(
      true,
    )
  })

  it('does nothing with a mouse', () => {
    coarse(false)
    const vibrate = vi.fn()
    Object.assign(navigator, { vibrate })
    haptic()
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('feels a tap on what is tappable, as each asks', () => {
    expect(feel(html('<button><svg></svg></button>').firstElementChild)).toBe(
      'tap',
    )
    expect(feel(html('<div role="option">Food</div>'))).toBe('select')
    expect(feel(html('<button data-haptic="warning">Delete</button>'))).toBe(
      'warning',
    )
    expect(
      feel(
        html('<div data-haptic="off"><button>x</button></div>')
          .firstElementChild,
      ),
    ).toBeNull()
    expect(feel(html('<button disabled>x</button>'))).toBeNull()
    expect(feel(html('<p>text</p>'))).toBeNull()
  })
})
