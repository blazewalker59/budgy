import { describe, expect, it } from 'vitest'
import { layoutSankey, spreadLabels } from '@/lib/layout/sankey'

describe('layoutSankey', () => {
  const nodes = [
    { id: 'pay', column: 0, value: 100 },
    { id: 'rent', column: 1, value: 60 },
    { id: 'food', column: 1, value: 40 },
  ]
  const links = [
    { from: 'pay', to: 'rent', value: 60 },
    { from: 'pay', to: 'food', value: 40 },
  ]

  it('sizes every node by one scale, the fullest column filling the height', () => {
    const { nodes: placed } = layoutSankey(nodes, links, {
      width: 300,
      height: 210,
      nodeWidth: 10,
      gap: 10,
    })
    const at = (id: string) => placed.find((p) => p.node.id === id)!
    // Column 1 holds 100 across two bars and a gap: 200px for 100.
    expect(at('rent').h).toBeCloseTo(120)
    expect(at('food').h).toBeCloseTo(80)
    expect(at('food').y).toBeCloseTo(130)
    expect(at('pay').h).toBeCloseTo(200)
    expect(at('pay').x).toBe(0)
    expect(at('rent').x).toBe(290)
  })

  it('stacks links on both ends in order', () => {
    const { links: placed } = layoutSankey(nodes, links, {
      width: 300,
      height: 210,
      nodeWidth: 10,
      gap: 10,
    })
    // Rent's band leaves pay at the top; food's starts where rent's ends.
    expect(placed[0].path.startsWith('M10,0C')).toBe(true)
    expect(placed[1].path.startsWith('M10,120C')).toBe(true)
    expect(placed[1].path).toContain('290,130')
  })

  it('skips a link to a node that isn’t there, and copes with nothing', () => {
    const { links: placed } = layoutSankey(
      nodes,
      [...links, { from: 'pay', to: 'gone', value: 5 }],
      { width: 300, height: 210, nodeWidth: 10, gap: 10 },
    )
    expect(placed).toHaveLength(2)
    expect(
      layoutSankey([], [], { width: 300, height: 210, nodeWidth: 10, gap: 10 }),
    ).toEqual({ nodes: [], links: [] })
  })
})

describe('spreadLabels', () => {
  it('leaves labels with room where they are', () => {
    expect(spreadLabels([20, 80, 140], 26, 200)).toEqual([20, 80, 140])
  })

  it('pushes crowded labels apart, downwards first', () => {
    expect(spreadLabels([20, 30, 40], 26, 200)).toEqual([20, 46, 72])
  })

  it('keeps labels inside, pushing back up from the bottom', () => {
    expect(spreadLabels([5, 190, 195], 26, 200)).toEqual([13, 161, 187])
  })
})
