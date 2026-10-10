import { describe, expect, it } from 'vitest'
import {
  dollars,
  money,
  parseDollars,
  shortDollars,
  signedDollars,
} from '@/lib/model/money'

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

describe('shortDollars', () => {
  it('stays exact under $100k, then shortens', () => {
    expect(shortDollars(7_519_00)).toBe('$7,519')
    expect(shortDollars(99_999_00)).toBe('$99,999')
    expect(shortDollars(302_611_00)).toBe('$303K')
    expect(shortDollars(1_061_489_00)).toBe('$1.06M')
    expect(shortDollars(-302_611_00)).toBe('-$303K')
  })
})
