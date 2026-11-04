export type SizeClass = 'compact' | 'regular'

export const regularMinWidth = 600

export const sizeClassOf = (width: number): SizeClass =>
  width >= regularMinWidth ? 'regular' : 'compact'

export const metricsOf = (sizeClass: SizeClass) =>
  sizeClass === 'regular'
    ? { gutter: 28, gap: 14, wideCard: 300, posterCard: 150, minTile: 150 }
    : { gutter: 16, gap: 10, wideCard: 220, posterCard: 112, minTile: 100 }

export const gridOf = (width: number): { columns: number; tile: number; gap: number } => {
  const { gutter, gap, minTile } = metricsOf(sizeClassOf(width))
  const inner = Math.max(0, width - 2 * gutter)
  const columns = Math.max(3, Math.floor((inner + gap) / (minTile + gap)))
  return { columns, tile: (inner - gap * (columns - 1)) / columns, gap }
}
