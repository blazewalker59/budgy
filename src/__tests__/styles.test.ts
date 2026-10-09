import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// iOS zooms into a focused field set under 16px, which breaks the layout.
describe('text fields on touch screens', () => {
  const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')
  const rule = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)?.[1]

  it('are at least 16px, outside any layer so utilities can’t shrink them', () => {
    expect(rule).toBeDefined()
    expect(rule).toMatch(/input:not\(/)
    expect(rule).toMatch(/select,/)
    expect(rule).toMatch(/textarea \{\s*font-size: 16px;/)
    const before = css.slice(0, css.indexOf('@media (pointer: coarse)'))
    const opened = (before.match(/@layer[^{;]*\{/g) ?? []).length
    const depth = [...before].reduce(
      (n, c) => n + (c === '{' ? 1 : c === '}' ? -1 : 0),
      0,
    )
    expect(depth, `inside ${opened ? 'a layer' : 'a block'}`).toBe(0)
  })
})
