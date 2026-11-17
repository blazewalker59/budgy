/**
 * Donut geometry: each value an arc of a ring in proportion to the total,
 * clockwise from 12 o'clock, with a small gap between arcs. Angles are in
 * radians. Pure arithmetic; the component draws the paths.
 */

export interface Arc {
  start: number
  end: number
}

const TOP = -Math.PI / 2

/**
 * Arcs for `values` around a full ring, leaving `gap` radians between
 * neighbours (none with a single arc). Zero or less gets an empty arc.
 */
export function arcs(values: ReadonlyArray<number>, gap = 0): Array<Arc> {
  const sized = values.map((v) => Math.max(0, v))
  const total = sized.reduce((n, v) => n + v, 0)
  const count = sized.filter((v) => v > 0).length
  const space = 2 * Math.PI - (count > 1 ? gap * count : 0)
  let at = TOP
  return sized.map((v) => {
    if (!total || v <= 0) return { start: at, end: at }
    const start = at + (count > 1 ? gap / 2 : 0)
    const end = start + (v / total) * space
    at = end + (count > 1 ? gap / 2 : 0)
    return { start, end }
  })
}

const point = (cx: number, cy: number, r: number, angle: number) =>
  `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`

/** An SVG path for the band between radii `inner` and `outer` along an arc. */
export function arcPath(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  { start, end }: Arc,
): string {
  if (end - start <= 0) return ''
  // A full circle can't be one arc: draw it as two halves.
  if (end - start >= 2 * Math.PI - 1e-9) {
    const mid = start + Math.PI
    return (
      arcPath(cx, cy, inner, outer, { start, end: mid }) +
      arcPath(cx, cy, inner, outer, { start: mid, end: start + 2 * Math.PI })
    )
  }
  const large = end - start > Math.PI ? 1 : 0
  return (
    `M${point(cx, cy, outer, start)}` +
    `A${outer},${outer} 0 ${large} 1 ${point(cx, cy, outer, end)}` +
    `L${point(cx, cy, inner, end)}` +
    `A${inner},${inner} 0 ${large} 0 ${point(cx, cy, inner, start)}Z`
  )
}
