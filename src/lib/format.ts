import type { Tag } from '@/lib/model/types'

export const TAG_TEXT: Record<Tag, string> = {
  need: 'text-need',
  nice: 'text-nice',
  fluff: 'text-fluff',
}
export const TAG_BG: Record<Tag, string> = {
  need: 'bg-need',
  nice: 'bg-nice',
  fluff: 'bg-fluff',
}

/** Whose Account, as a dot color. */
export function ownerColor(owner: string): string {
  if (owner === 'Blaze') return '#2f6db5'
  if (owner === 'Alex') return '#c2417a'
  return '#8a8f93'
}

/** Tag names short enough for a narrow select. */
export const TAG_SHORT: Record<Tag, string> = {
  need: 'Need',
  nice: 'Nice',
  fluff: 'Fluff',
}

/** Distinct colors for Categories in a chart, in order; the last is "the rest". */
export const MIX_COLORS = [
  '#2f7fc1',
  '#d1497f',
  '#d39a2a',
  '#1f9a78',
  '#7d5cf0',
  '#e0663f',
  '#3db3c9',
  '#9b7a2a',
  '#6c9a3a',
]
export const MIX_REST = '#8a8f93'
