/**
 * Sankey geometry for a few fixed columns: each node a bar as tall as its
 * value, each link a band from one bar to the next as wide as its value,
 * stacked in order on both ends. Pure arithmetic in pixels.
 */

export interface FlowNode {
  id: string
  /** Left to right, from 0. */
  column: number
  value: number
}

export interface FlowLink {
  from: string
  to: string
  value: number
}

export interface PlacedNode<TNode extends FlowNode> {
  node: TNode
  x: number
  y: number
  h: number
}

export interface PlacedLink<TLink extends FlowLink> {
  link: TLink
  /** A closed band, ready for an SVG path's `d`. */
  path: string
}

export interface SankeyLayout<TNode extends FlowNode, TLink extends FlowLink> {
  nodes: Array<PlacedNode<TNode>>
  links: Array<PlacedLink<TLink>>
}

export function layoutSankey<TNode extends FlowNode, TLink extends FlowLink>(
  nodes: ReadonlyArray<TNode>,
  links: ReadonlyArray<TLink>,
  {
    width,
    height,
    nodeWidth,
    gap,
  }: { width: number; height: number; nodeWidth: number; gap: number },
): SankeyLayout<TNode, TLink> {
  const columns = [...new Set(nodes.map((n) => n.column))].sort((a, b) => a - b)
  const last = columns.length - 1
  // One scale for every column: the fullest column fills the height.
  const scale = Math.min(
    ...columns.map((c) => {
      const list = nodes.filter((n) => n.column === c)
      const sum = list.reduce((s, n) => s + n.value, 0)
      return sum > 0 ? (height - gap * (list.length - 1)) / sum : Infinity
    }),
  )
  const k = Number.isFinite(scale) ? scale : 0
  const x = (column: number) =>
    last > 0 ? (columns.indexOf(column) / last) * (width - nodeWidth) : 0

  const placed = new Map<string, PlacedNode<TNode>>()
  for (const c of columns) {
    let y = 0
    for (const node of nodes.filter((n) => n.column === c)) {
      const h = node.value * k
      placed.set(node.id, { node, x: x(c), y, h })
      y += h + gap
    }
  }

  const out = new Map<string, number>()
  const into = new Map<string, number>()
  const bands: Array<PlacedLink<TLink>> = []
  for (const link of links) {
    const a = placed.get(link.from)
    const b = placed.get(link.to)
    if (!a || !b) continue
    const h = link.value * k
    const y0 = a.y + (out.get(link.from) ?? 0)
    const y1 = b.y + (into.get(link.to) ?? 0)
    out.set(link.from, (out.get(link.from) ?? 0) + h)
    into.set(link.to, (into.get(link.to) ?? 0) + h)
    const x0 = a.x + nodeWidth
    const x1 = b.x
    const mid = (x0 + x1) / 2
    bands.push({
      link,
      path:
        `M${x0},${y0}C${mid},${y0} ${mid},${y1} ${x1},${y1}` +
        `L${x1},${y1 + h}C${mid},${y1 + h} ${mid},${y0 + h} ${x0},${y0 + h}Z`,
    })
  }
  return { nodes: [...placed.values()], links: bands }
}

/**
 * Label centres for one column, each as near its own `wanted` centre as it
 * can be while staying `spacing` from its neighbours and within 0 to
 * `height`. In the order given, which is top to bottom.
 */
export function spreadLabels(
  wanted: ReadonlyArray<number>,
  spacing: number,
  height: number,
): Array<number> {
  const out = [...wanted]
  // Down: each at least `spacing` below the one above.
  for (let i = 0; i < out.length; i++)
    out[i] = Math.max(out[i], i ? out[i - 1] + spacing : spacing / 2)
  // Up: back inside the bottom, pushing those above up in turn.
  for (let i = out.length - 1; i >= 0; i--)
    out[i] = Math.min(
      out[i],
      i < out.length - 1 ? out[i + 1] - spacing : height - spacing / 2,
    )
  return out
}
