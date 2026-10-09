/**
 * A small fuzzy matcher for the ⌘K palette. Each whitespace-separated query
 * token must match the label or the keywords; tokens score by how well they
 * match — a prefix beats a word start beats a substring beats a scattered
 * subsequence — and the label's matched characters come back as ranges so
 * the palette can highlight them.
 */

export type Range = readonly [start: number, end: number] // inclusive

export interface Match {
  score: number
  /** Matched character ranges in the label (for highlighting). */
  ranges: Array<Range>
}

const WORD_BREAK = /[\s\-_/.@#·:]/

/** How well `token` matches `text` (both lower-cased), with where. */
function matchToken(
  token: string,
  text: string,
): { score: number; ranges: Array<Range> } | null {
  if (!token) return { score: 0, ranges: [] }
  const at = text.indexOf(token)
  if (at === 0) return { score: 100, ranges: [[0, token.length - 1]] }
  if (at > 0) {
    // Prefer an occurrence that starts a word ("ref" in "t4-ref-data").
    let wordStart = -1
    for (let i = at; i !== -1; i = text.indexOf(token, i + 1)) {
      if (WORD_BREAK.test(text[i - 1] ?? '')) {
        wordStart = i
        break
      }
    }
    if (wordStart > 0)
      return { score: 80, ranges: [[wordStart, wordStart + token.length - 1]] }
    return {
      score: 60 - Math.min(at, 20),
      ranges: [[at, at + token.length - 1]],
    }
  }
  // Scattered subsequence ("trd" → t4-ref-data): score drops with every gap.
  const ranges: Array<[number, number]> = []
  let pos = 0
  let gaps = 0
  for (const ch of token) {
    const i = text.indexOf(ch, pos)
    if (i === -1) return null
    // Only jumps between matched letters count; where the match starts doesn't.
    if (ranges.length > 0 && i > pos) gaps += 1
    const last = ranges[ranges.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else ranges.push([i, i])
    pos = i + 1
  }
  // Too scattered to be what anyone meant: many jumps, or letters strewn
  // across a long stretch of text.
  const span = ranges[ranges.length - 1]![1] - ranges[0]![0] + 1
  if (gaps > Math.max(2, token.length / 2) || span > token.length * 4)
    return null
  return { score: 30 - gaps * 4, ranges }
}

/** Score an entry against the query, or null when any token misses. */
export function fuzzyMatch(
  query: string,
  label: string,
  keywords = '',
): Match | null {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { score: 0, ranges: [] }
  const l = label.toLowerCase()
  const k = keywords.toLowerCase()
  let score = 0
  const ranges: Array<Range> = []
  for (const t of tokens) {
    const inLabel = matchToken(t, l)
    const inKeywords = matchToken(t, k)
    // The label is what's shown, so it outranks a keyword hit of equal quality.
    const labelScore = inLabel ? inLabel.score + 10 : -1
    const keywordScore = inKeywords ? inKeywords.score : -1
    if (labelScore < 0 && keywordScore < 0) return null
    if (labelScore >= keywordScore) {
      score += labelScore
      ranges.push(...inLabel!.ranges)
    } else {
      score += keywordScore
    }
  }
  // Shorter labels win ties: "code" should rank Code above "Code review".
  return { score: score - label.length * 0.05, ranges: mergeRanges(ranges) }
}

function mergeRanges(ranges: Array<Range>): Array<Range> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}
