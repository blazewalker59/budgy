/** Steps a person would pick: 1, 2, 2.5 or 5 times a power of ten. */
const NICE = [1, 2, 2.5, 5, 10]

/**
 * Axis ticks from 0 past `max` in round steps, at most about `count` of
 * them: 13,600 gives 0, 5,000, 10,000, 15,000. The last tick is the
 * axis's top.
 */
export function niceTicks(max: number, count = 4): Array<number> {
  return niceTicksBetween(0, max, count)
}

/**
 * Round ticks covering `min` to `max` and always zero, about `count`
 * steps apart: -2,300 to 9,100 gives -5,000, 0, 5,000, 10,000. The first
 * and last ticks are the axis's ends.
 */
export function niceTicksBetween(
  min: number,
  max: number,
  count = 4,
): Array<number> {
  const low = Math.min(0, Number.isFinite(min) ? min : 0)
  const high = Math.max(0, Number.isFinite(max) ? max : 0)
  if (high - low <= 0) return [0, 1]
  const raw = (high - low) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = magnitude * NICE.find((n) => n * magnitude >= raw)!
  const below = Math.ceil(-low / step - 1e-9)
  const above = Math.ceil(high / step - 1e-9)
  return Array.from({ length: below + above + 1 }, (_, i) => (i - below) * step)
}
