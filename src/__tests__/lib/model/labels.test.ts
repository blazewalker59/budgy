import { describe, expect, it } from 'vitest'
import { ledger } from '../../_setup/factories'
import type { Account } from '@/lib/model/types'
import {
  LABEL_COLORS,
  LABEL_COLOR_KEYS,
  labeledLedger,
  nextColor,
  othersStartingWith,
  relabeledLedger,
  shownAs,
  suggestShownAs,
  unlabeledLedger,
} from '@/lib/model/labels'

const acct = (name: string, over: Partial<Account> = {}): Account => ({
  name,
  sourceName: name,
  owner: 'Joint',
  kind: 'education',
  institution: null,
  closed: false,
  securedBy: null,
  ...over,
})

describe('suggestShownAs', () => {
  it('is the rest of a name that starts with the label', () => {
    expect(suggestShownAs('Addie 529', 'Addie')).toBe('529')
    expect(suggestShownAs('Addie Trump Account', 'addie')).toBe('Trump Account')
    expect(suggestShownAs('Addie’s Trump Account', 'Addie')).toBe(
      'Trump Account',
    )
    expect(suggestShownAs("Addie's 529", 'Addie')).toBe('529')
  })

  it('is nothing when the name only shares letters, or is just the label', () => {
    expect(suggestShownAs('Addiesavings', 'Addie')).toBeNull()
    expect(suggestShownAs('Addie', 'Addie')).toBeNull()
    expect(suggestShownAs('Joint Checking', 'Addie')).toBeNull()
    expect(suggestShownAs('Addie 529', ' ')).toBeNull()
  })

  it('treats a label as text, not a pattern', () => {
    expect(suggestShownAs('A+ Savings', 'A+')).toBe('Savings')
    expect(suggestShownAs('AA Savings', 'A.')).toBeNull()
  })
})

describe('othersStartingWith', () => {
  it('lists the other unlabelled Accounts the label starts, with their Shown as', () => {
    const accounts = [
      acct('Addie 529'),
      acct('Addie Trump Account'),
      acct('Addie Savings', { displayName: 'Piggy bank' }),
      acct('Addie Old', { label: 'Addie' }),
      acct('Asher 529'),
    ]
    expect(othersStartingWith(accounts, 'addie', 'Addie 529')).toEqual([
      { name: 'Addie Trump Account', displayName: 'Trump Account' },
      { name: 'Addie Savings', displayName: 'Piggy bank' },
    ])
    expect(othersStartingWith(accounts, 'Nobody', 'Addie 529')).toEqual([])
  })
})

describe('shownAs', () => {
  it('is the Shown as, or the name', () => {
    expect(shownAs(acct('Addie 529', { displayName: '529' }))).toBe('529')
    expect(shownAs(acct('Addie 529'))).toBe('Addie 529')
  })
})

describe('nextColor', () => {
  it('is the first colour no label has', () => {
    expect(nextColor([])).toBe('red')
    expect(nextColor([{ name: 'A', color: 'red' }])).toBe('orange')
  })
})

describe('ledger patches', () => {
  const base = ledger({
    accounts: [
      acct('Addie 529', { label: 'Addie', displayName: '529' }),
      acct('Asher 529'),
    ],
    labels: [{ name: 'Addie', color: 'pink' }],
  })

  it('rename a label on its Accounts', () => {
    const next = relabeledLedger(base, 'Addie', { name: 'A', color: 'red' })
    expect(next.labels).toEqual([{ name: 'A', color: 'red' }])
    expect(next.accounts[0].label).toBe('A')
  })

  it('clear a deleted label, keeping Shown as', () => {
    const next = unlabeledLedger(base, 'Addie')
    expect(next.labels).toEqual([])
    expect(next.accounts[0]).toMatchObject({ label: null, displayName: '529' })
  })

  it('label several Accounts', () => {
    const next = labeledLedger(base, 'Addie', [
      { name: 'Asher 529', displayName: null },
    ])
    expect(next.accounts[1]).toMatchObject({
      label: 'Addie',
      displayName: null,
    })
  })
})

/** WCAG relative luminance contrast. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('LABEL_COLORS', () => {
  it('has ten colours whose chip text reads at 4.5:1 or better in both themes', () => {
    expect(LABEL_COLOR_KEYS).toHaveLength(10)
    for (const key of LABEL_COLOR_KEYS)
      for (const theme of ['light', 'dark'] as const) {
        const { bg, fg } = LABEL_COLORS[key][theme]
        expect(contrast(fg, bg), `${key} ${theme}`).toBeGreaterThanOrEqual(4.5)
      }
  })

  it('stands apart from the surface it sits on, as a swatch', () => {
    // A swatch is the chip text colour on the app's surface (styles.css).
    for (const key of LABEL_COLOR_KEYS) {
      expect(contrast(LABEL_COLORS[key].light.fg, '#ffffff')).toBeGreaterThan(3)
      expect(contrast(LABEL_COLORS[key].dark.fg, '#171b1a')).toBeGreaterThan(3)
    }
  })
})
