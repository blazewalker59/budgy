// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { ledger, paySchedule, plan, txn } from '@test/factories'
import type { Occurrence } from '@/lib/model/plans'
import { indexLedger } from '@/lib/model/ledger'
import { monthView } from '@/lib/model/month'
import { VISUAL_KEY, Visuals } from '@/components/month/visuals/Visuals'

// jsdom has no PointerEvent; swipes need its pointer fields on a mouse event.
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number
      pointerType: string
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.pointerType = init.pointerType ?? 'mouse'
      }
    }
    window.PointerEvent = PointerEventPolyfill as typeof PointerEvent
  }
})
// Node's own global localStorage (empty without a file) hides jsdom's: an
// in-memory one stands in for the device.
beforeEach(() => {
  const items = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, String(v)),
    removeItem: (k: string) => void items.delete(k),
    clear: () => items.clear(),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const today = '2026-11-16'
const ix = indexLedger(
  ledger({
    txns: [
      txn({ date: '2026-11-05', store: 'Kroger', amount: 30_000 }),
      txn({ date: '2026-11-06', store: 'Publix', amount: 20_000 }),
      txn({
        date: '2026-11-05',
        store: 'Amazon',
        sourceCategory: 'Shopping',
        amount: 15_000,
      }),
      txn({
        date: '2026-11-08',
        store: 'Cafe',
        sourceCategory: 'Drinks & dining',
        amount: 5_000,
      }),
    ],
    // Paid every two weeks: Nov 13 and Nov 27.
    pay: [paySchedule({ anchor: '2026-09-04' })],
  }),
)

function show(occurrences: Array<Occurrence> = []) {
  return render(
    <Visuals
      view={monthView(ix, '2026-11', today, null, occurrences)}
      ix={ix}
      occurrences={occurrences}
      today={today}
      takeHome={400_000}
    />,
  )
}

const selected = () =>
  screen.getByRole('tab', { selected: true }).textContent ?? ''

function swipe(from: number, to: number, pointerType = 'touch', dy = 0) {
  const viewport = screen.getByTestId('visuals-viewport')
  const at = (x: number, y: number) => ({
    clientX: x,
    clientY: y,
    pointerId: 7,
    pointerType,
  })
  fireEvent.pointerDown(viewport, at(from, 100))
  fireEvent.pointerMove(viewport, at((from + to) / 2, 100 + dy / 2))
  fireEvent.pointerMove(viewport, at(to, 100 + dy))
  fireEvent.pointerUp(viewport, at(to, 100 + dy))
}

describe('Overview visuals', () => {
  it('shows Pace first, then any visual tapped, and remembers it', () => {
    show()
    expect(selected()).toBe('Pace')
    expect(
      screen.getByRole('img', { name: /\$700 everyday spending so far/ }),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Day by day' }))
    expect(selected()).toBe('Day by day')
    expect(localStorage.getItem(VISUAL_KEY)).toBe('days')
  })

  it('opens on the visual last shown on this device', () => {
    localStorage.setItem(VISUAL_KEY, 'flow')
    show()
    expect(selected()).toBe('Flow')
  })

  it('ignores a remembered visual that no longer exists', () => {
    localStorage.setItem(VISUAL_KEY, 'pie')
    show()
    expect(selected()).toBe('Pace')
  })

  it('steps with the arrows and the keyboard, wrapping around', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Previous visual' }))
    expect(selected()).toBe('Flow')
    fireEvent.click(screen.getByRole('button', { name: 'Next visual' }))
    expect(selected()).toBe('Pace')
    const card = screen.getByRole('region', { name: 'Visuals' })
    fireEvent.keyDown(card, { key: 'ArrowRight' })
    expect(selected()).toBe('Where it went')
    fireEvent.keyDown(card, { key: 'ArrowLeft' })
    expect(selected()).toBe('Pace')
  })

  it('turns with a sideways swipe, not a scroll or a mouse drag', () => {
    show()
    swipe(300, 200)
    expect(selected()).toBe('Where it went')
    expect(localStorage.getItem(VISUAL_KEY)).toBe('where')
    swipe(200, 300)
    expect(selected()).toBe('Pace')
    // Too short to count.
    swipe(300, 270)
    expect(selected()).toBe('Pace')
    // Mostly up the page: scrolling.
    swipe(300, 240, 'touch', 200)
    expect(selected()).toBe('Pace')
    swipe(300, 100, 'mouse')
    expect(selected()).toBe('Pace')
  })

  it('shows Where it went as a donut, opening a Category for its stores', () => {
    localStorage.setItem(VISUAL_KEY, 'where')
    show()
    expect(
      screen.getByRole('img', {
        name: '$700 everyday: Need 71%, Nice to have 21%, Fluff 7%.',
      }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Groceries, $500' }))
    expect(screen.getByText('Kroger')).toBeTruthy()
    expect(screen.getByText('Publix')).toBeTruthy()
    expect(screen.getByText(/2 purchases at 2 stores/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All Categories' }))
    expect(screen.getByRole('button', { name: 'Shopping, $150' })).toBeTruthy()
  })

  it('lists a day’s purchases in Day by day, with paydays marked', () => {
    localStorage.setItem(VISUAL_KEY, 'days')
    show()
    expect(
      screen.getByRole('button', { name: 'Nov 13, nothing spent, payday' }),
    ).toBeTruthy()
    // Ahead: no "nothing spent" yet, just what's coming.
    expect(screen.getByRole('button', { name: 'Nov 27, payday' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Nov 5, $450' }))
    const list = screen.getByRole('list')
    expect(within(list).getByText('Kroger')).toBeTruthy()
    expect(within(list).getByText('Amazon')).toBeTruthy()
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('says in words where the money flowed', () => {
    localStorage.setItem(VISUAL_KEY, 'flow')
    show()
    expect(
      screen.getByRole('img', {
        name: /^Take-home \$4,000\. Then Everyday \$700, Left \$3,300\. Then Need \$500, Nice to have \$150, Fluff \$50\.$/,
      }),
    ).toBeTruthy()
  })

  it('lists a tapped day’s bills, which a phone shows only as marks', () => {
    localStorage.setItem(VISUAL_KEY, 'days')
    const spotify = plan({ name: 'Spotify', amount: 2_200, cadence: 'monthly' })
    show([{ plan: spotify, due: '2026-11-21', paidBy: null }])
    fireEvent.click(screen.getByRole('button', { name: 'Nov 21, Spotify due' }))
    expect(screen.getByText('Spotify · due')).toBeTruthy()
    expect(screen.getByText('$22')).toBeTruthy()
  })
})
