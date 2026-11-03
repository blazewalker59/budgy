import { describe, expect, it } from 'vitest'
import {
  EMPTY_RULES,
  compile,
  importRulesSchema,
  parseImportRules,
  unsafePattern,
} from '@/lib/import/rules'

const rules = (over: Record<string, unknown>) => ({
  stores: [],
  upkeep: '',
  mortgage: '',
  notSpending: '',
  ...over,
})

describe('unsafePattern', () => {
  it('accepts the patterns Store rules use', () => {
    for (const ok of [
      '',
      'Green Lawn|^Bug Guys$',
      'Homeloan Servicing',
      '\\bACE\\s+HARDWARE\\b',
      '^(?:LOWE|HOME DEPOT)\\b',
      'AMZN\\s*Mktp.*',
      '[a-z]+ ?plumb(ing|er)',
      'roof(ing)?',
      '\\(+\\)+',
      '[(]+',
    ])
      expect(unsafePattern(ok), ok).toBeNull()
  })

  it('refuses nested repetition, repeated alternatives and backreferences', () => {
    for (const bad of [
      '(a+)+$',
      '(a*)*b',
      '(\\w+\\s?)*$',
      '(a|aa)+$',
      '(?:x+){2,}',
      '((a+))+',
      '((ab)*c)+',
      '(a)\\1',
      '(?<x>a)\\k<x>',
      '\\s*\\s*\\s*\\s*\\s*\\s*\\s*x',
    ])
      expect(unsafePattern(bad), bad).not.toBeNull()
  })

  it('finishes quickly on what it refuses, and on what it accepts', () => {
    const start = performance.now()
    unsafePattern('(a+)+'.repeat(100))
    expect(performance.now() - start).toBeLessThan(200)
  })
})

describe('importRulesSchema', () => {
  it('refuses an unsafe or over-long pattern at save time, saying why', () => {
    const nested = importRulesSchema.safeParse(rules({ upkeep: '(a+)+$' }))
    expect(nested.success).toBe(false)
    expect(JSON.stringify(nested.error?.issues)).toContain('repeated group')
    expect(
      importRulesSchema.safeParse(rules({ notSpending: 'x'.repeat(501) }))
        .success,
    ).toBe(false)
    expect(
      importRulesSchema.safeParse(rules({ upkeep: 'Green Lawn|^Bug Guys$' }))
        .success,
    ).toBe(true)
  })
})

describe('stored rules', () => {
  it('still load a long safe pattern saved before the cap', () => {
    const upkeep = Array.from({ length: 120 }, (_, i) => `Vendor${i}`).join('|')
    expect(upkeep.length).toBeGreaterThan(500)
    const loaded = parseImportRules(JSON.stringify(rules({ upkeep })))
    expect(loaded.upkeep).toBe(upkeep)
    expect(compile(loaded.upkeep, 'i')?.test('vendor7')).toBe(true)
  })

  it('never run an unsafe pattern saved before the check', () => {
    const loaded = parseImportRules(
      JSON.stringify(rules({ upkeep: '(a+)+$', mortgage: 'Servicing' })),
    )
    expect(loaded).not.toEqual(EMPTY_RULES)
    expect(compile(loaded.upkeep)).toBeNull()
    expect(compile(loaded.mortgage)?.test('Homeloan Servicing')).toBe(true)
  })
})
