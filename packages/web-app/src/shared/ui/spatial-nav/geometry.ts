// Spatial navigation (§19), the pure part: which element an arrow goes to,
// from the rectangles of the focused element and of the candidates. The
// scoring follows CSS Spatial Navigation: only candidates past the focused
// element in the arrow's direction, the distance along the direction plus a
// weighted offset across it, minus the span both share across the direction
// (an aligned element wins); among the candidates of the nearest line only.

export type Rect = { left: number; top: number; right: number; bottom: number }

export type Direction = 'up' | 'down' | 'left' | 'right'

export const isHorizontal = (direction: Direction) => direction === 'left' || direction === 'right'

// Rounding and borders: an element 1 px into the focused one is still past it.
const tolerancePx = 2

const crossWeight = (direction: Direction) => (isHorizontal(direction) ? 30 : 2)

type Span = { start: number; end: number }

const along = (rect: Rect, direction: Direction): Span =>
  isHorizontal(direction)
    ? { start: rect.left, end: rect.right }
    : { start: rect.top, end: rect.bottom }

const across = (rect: Rect, direction: Direction): Span =>
  isHorizontal(direction)
    ? { start: rect.top, end: rect.bottom }
    : { start: rect.left, end: rect.right }

const forward = (direction: Direction) => direction === 'down' || direction === 'right'

/** How far `to` lies past `from` in the direction (negative when they overlap on that axis). */
const gapAlong = (from: Rect, to: Rect, direction: Direction) => {
  const a = along(from, direction)
  const b = along(to, direction)
  return forward(direction) ? b.start - a.end : a.start - b.end
}

const gapAcross = (a: Span, b: Span) =>
  Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end))

const overlapAcross = (a: Span, b: Span) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))

const center = (span: Span) => (span.start + span.end) / 2

/** Entirely past `from` in the direction. */
const strictlyPast = (from: Rect, to: Rect, direction: Direction) =>
  gapAlong(from, to, direction) >= -tolerancePx

/**
 * On the same line but overlapping it on the axis: its centre and far edge
 * are past `from`'s.
 */
const looselyPast = (from: Rect, to: Rect, direction: Direction) => {
  const a = along(from, direction)
  const b = along(to, direction)
  if (overlapAcross(across(from, direction), across(to, direction)) <= 0) return false
  return forward(direction)
    ? center(b) > center(a) && b.end > a.end
    : center(b) < center(a) && b.start < a.start
}

export const distanceTo = (from: Rect, to: Rect, direction: Direction) => {
  const primary = Math.max(0, gapAlong(from, to, direction))
  const fromAcross = across(from, direction)
  const toAcross = across(to, direction)
  const cross = gapAcross(fromAcross, toAcross)
  return (
    Math.hypot(primary, cross) +
    primary +
    cross * crossWeight(direction) -
    overlapAcross(fromAcross, toAcross)
  )
}

// The nearest line is what starts within this much (or the focused element's
// own size) of the nearest candidate.
const minBandPx = 24

/**
 * The index of the candidate an arrow moves to from `from`, or undefined when
 * none lies that way: ←/→ only along the focused element's line; the nearest
 * line first (a row of buttons above wins over the header further up, even
 * off to the side), then the best scored in it. Ties go to the earlier
 * candidate (document order).
 */
export const pickInDirection = (
  from: Rect,
  candidates: readonly Rect[],
  direction: Direction,
): number | undefined => {
  const fromAcross = across(from, direction)
  const fromAlong = along(from, direction)
  const onLine = candidates
    .map((rect, index) => ({ rect, index }))
    .filter(
      ({ rect }) =>
        !isHorizontal(direction) || overlapAcross(fromAcross, across(rect, direction)) > 0,
    )
  const strict = onLine.filter(({ rect }) => strictlyPast(from, rect, direction))
  const pool =
    strict.length > 0 ? strict : onLine.filter(({ rect }) => looselyPast(from, rect, direction))
  const gapOf = (rect: Rect) => Math.max(0, gapAlong(from, rect, direction))
  const nearest = Math.min(...pool.map(({ rect }) => gapOf(rect)))
  const band = nearest + Math.max(minBandPx, fromAlong.end - fromAlong.start)
  let best: { index: number; distance: number } | undefined
  for (const { rect, index } of pool) {
    if (gapOf(rect) > band) continue
    const distance = distanceTo(from, rect, direction)
    if (best === undefined || distance < best.distance) best = { index, distance }
  }
  return best?.index
}

/**
 * Whether a widget's items run across (tabs, segments) rather than down (a
 * list): from where its first two items lie.
 */
export const runsAcross = (items: readonly Rect[]) => {
  const [first, second] = items
  if (first === undefined || second === undefined) return true
  const dx = Math.abs((second.left + second.right) / 2 - (first.left + first.right) / 2)
  const dy = Math.abs((second.top + second.bottom) / 2 - (first.top + first.bottom) / 2)
  return dx >= dy
}

/** Whether `rect` shows inside the viewport (below the sticky header, `top`). */
export const isInView = (rect: Rect, view: Rect) =>
  rect.bottom > view.top &&
  rect.top < view.bottom &&
  rect.right > view.left &&
  rect.left < view.right

/**
 * How far to scroll (along one axis) so `rect` shows inside `view` with
 * `margin`: 0 when it already does; an element taller than the view aligns
 * its start.
 */
export const scrollDelta = (rect: Span, view: Span, margin: number) => {
  const room = view.end - view.start - margin * 2
  if (rect.start < view.start + margin || rect.end - rect.start > room)
    return rect.start - (view.start + margin)
  if (rect.end > view.end - margin) return rect.end - (view.end - margin)
  return 0
}
