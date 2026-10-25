/**
 * Where a card's preview opens (artboard `Home`, `.preview`): centred over the card, `restingTop`
 * above it, then shifted so it stays whole inside `bounds` (the row's visible strip across, the
 * window under the header down). The row and window edges would otherwise cut it: the row clips it
 * across, the window bottom hides the actions of a card low on the screen.
 */

type Box = { left: number; top: number; width: number; height: number }
type Bounds = { left: number; right: number; top: number; bottom: number }

/** Offsets from the card's top-left corner, and the horizontal origin of the opening (0–1). */
export type PreviewPlacement = { left: number; top: number; originX: number }

/** `min` wins when the range is empty. */
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export const placePreview = ({
  card,
  preview,
  bounds,
  restingTop,
}: {
  card: Box
  preview: { width: number; height: number }
  bounds: Bounds
  restingTop: number
}): PreviewPlacement => {
  const centred = card.left + (card.width - preview.width) / 2
  // Too wide or too tall for the bounds: the start (left, top) stays visible.
  const left = clamp(centred, bounds.left, bounds.right - preview.width)
  const top = clamp(card.top + restingTop, bounds.top, bounds.bottom - preview.height)
  // Grows out of the card: from its left edge when flush left, its right edge when flush right.
  const slack = preview.width - card.width
  const originX = slack > 0 ? clamp((card.left - left) / slack, 0, 1) : 0.5
  return { left: left - card.left, top: top - card.top, originX }
}
