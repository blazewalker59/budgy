/**
 * Where a month's money flows: take-home into Housing, planned bills,
 * everyday spending and what's left; everyday into Need, Nice and Fluff;
 * and each of those into its biggest Categories. Without take-home (a
 * Lens narrows to some people's spending), it starts at the spending.
 * Compact (a phone) skips the tags: everyday flows straight into its
 * biggest Categories, each still its tag's color.
 */

import { TAGS, TAG_LABELS } from './types'
import type { FlowLink, FlowNode } from '@/lib/layout/sankey'
import type { MonthView } from './month'
import type { Tag } from './types'

export type FlowKind =
  | 'pay'
  | 'beyond'
  | 'housing'
  | 'planned'
  | 'everyday'
  | 'left'
  /** Everyday's smaller Categories together, of mixed tags. */
  | 'rest'
  | Tag

export interface MoneyNode extends FlowNode {
  label: string
  kind: FlowKind
}

export interface MoneyFlow {
  nodes: Array<MoneyNode>
  links: Array<FlowLink>
}

/** Categories named under each tag; the rest join as "Other". */
const FLOW_TOP = 3
/** Categories named when compact, across tags. */
const COMPACT_TOP = 6

export function monthFlow(
  view: MonthView,
  takeHome: number | null,
  { compact = false }: { compact?: boolean } = {},
): MoneyFlow {
  const nodes: Array<MoneyNode> = []
  const links: Array<FlowLink> = []
  const all = [...view.everyday, ...view.housing]
  const housing = view.housing.reduce((n, c) => n + c.spent, 0)
  const planned = all.reduce((n, c) => n + c.plannedPaid, 0)
  const everyday = view.totals.spent
  const out = housing + planned + everyday

  const spending: Array<MoneyNode> = [
    {
      id: 'housing',
      label: 'Housing',
      kind: 'housing',
      column: 1,
      value: housing,
    },
    {
      id: 'planned',
      label: 'Planned bills',
      kind: 'planned',
      column: 1,
      value: planned,
    },
    {
      id: 'everyday',
      label: 'Everyday',
      kind: 'everyday',
      column: 1,
      value: everyday,
    },
  ].filter((n): n is MoneyNode => n.value > 0)

  if (takeHome !== null) {
    if (takeHome > 0)
      nodes.push({
        id: 'pay',
        label: 'Take-home',
        kind: 'pay',
        column: 0,
        value: takeHome,
      })
    if (out > takeHome)
      nodes.push({
        id: 'beyond',
        label: 'Beyond take-home',
        kind: 'beyond',
        column: 0,
        value: out - takeHome,
      })
    if (takeHome > out)
      spending.push({
        id: 'left',
        label: 'Left',
        kind: 'left',
        column: 1,
        value: takeHome - out,
      })
    // Take-home pays for each in turn; the rest came from beyond it.
    let fromPay = takeHome
    for (const n of spending) {
      const paid = Math.max(0, Math.min(fromPay, n.value))
      if (paid > 0) links.push({ from: 'pay', to: n.id, value: paid })
      if (n.value > paid)
        links.push({ from: 'beyond', to: n.id, value: n.value - paid })
      fromPay -= paid
    }
  }
  nodes.push(...spending)

  if (compact) {
    const cats = view.everyday
      .filter((c) => c.spent > 0)
      .sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name))
    for (const c of cats.slice(0, COMPACT_TOP)) {
      const id = `category:${c.name}`
      nodes.push({ id, label: c.name, kind: c.tag, column: 2, value: c.spent })
      links.push({ from: 'everyday', to: id, value: c.spent })
    }
    const rest = cats.slice(COMPACT_TOP)
    const value = rest.reduce((n, c) => n + c.spent, 0)
    if (value > 0) {
      nodes.push({
        id: 'other',
        label: `${rest.length} more`,
        kind: 'rest',
        column: 2,
        value,
      })
      links.push({ from: 'everyday', to: 'other', value })
    }
    return { nodes, links }
  }

  for (const tag of TAGS) {
    const cats = view.everyday
      .filter((c) => c.tag === tag && c.spent > 0)
      .sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name))
    const sum = cats.reduce((n, c) => n + c.spent, 0)
    if (sum <= 0) continue
    nodes.push({
      id: tag,
      label: TAG_LABELS[tag],
      kind: tag,
      column: 2,
      value: sum,
    })
    links.push({ from: 'everyday', to: tag, value: sum })
    for (const c of cats.slice(0, FLOW_TOP)) {
      const id = `category:${c.name}`
      nodes.push({ id, label: c.name, kind: tag, column: 3, value: c.spent })
      links.push({ from: tag, to: id, value: c.spent })
    }
    const rest = cats.slice(FLOW_TOP).reduce((n, c) => n + c.spent, 0)
    if (rest > 0) {
      const id = `other:${tag}`
      nodes.push({
        id,
        label: `Other ${TAG_LABELS[tag].toLowerCase()}`,
        kind: tag,
        column: 3,
        value: rest,
      })
      links.push({ from: tag, to: id, value: rest })
    }
  }
  return { nodes, links }
}
