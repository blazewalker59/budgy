import { describe, expect, it } from 'vitest'
import { dollars, money, parseDollars, signedDollars } from '@/lib/model/money'

describe('money', () => {
  it('formats cents', () => {
    expect(dollars(123_456)).toBe('$1,235')
    expect(money(123_456)).toBe('$1,234.56')
    expect(signedDollars(12_000)).toBe('+$120')
    expect(signedDollars(-8_000)).toBe('−$80')
    expect(signedDollars(20)).toBe('$0')
  })

  it('parses what people type', () => {
    expect(parseDollars('$1,234.5')).toBe(123_450)
    expect(parseDollars('80')).toBe(8_000)
    expect(parseDollars('')).toBeNull()
    expect(parseDollars('abc')).toBeNull()
  })
})
