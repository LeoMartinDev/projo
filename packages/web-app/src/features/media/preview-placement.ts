type Box = { left: number; top: number; width: number; height: number }
type Bounds = { left: number; right: number; top: number; bottom: number }

export type PreviewPlacement = { left: number; top: number; originX: number }

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
  const left = clamp(centred, bounds.left, bounds.right - preview.width)
  const top = clamp(card.top + restingTop, bounds.top, bounds.bottom - preview.height)
  const slack = preview.width - card.width
  const originX = slack > 0 ? clamp((card.left - left) / slack, 0, 1) : 0.5
  return { left: left - card.left, top: top - card.top, originX }
}
