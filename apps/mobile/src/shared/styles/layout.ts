/**
 * Layout of the browsing screens (§26.5), pure: an iPhone in portrait is `compact`; an iPad (or a
 * wide window next to its sidebar) is `regular`, with a layout of its own rather than an enlarged
 * iPhone: a landscape hero, bigger cards, more columns.
 */
export type SizeClass = 'compact' | 'regular'

/** Width of the content (the screen, minus the iPad sidebar) from which the layout is `regular`. */
export const regularMinWidth = 600

export const sizeClassOf = (width: number): SizeClass =>
  width >= regularMinWidth ? 'regular' : 'compact'

/** Side margins, and the room between cards (`MobileHome`: 16 and 10 on an iPhone). */
export const metricsOf = (sizeClass: SizeClass) =>
  sizeClass === 'regular'
    ? { gutter: 28, gap: 14, wideCard: 300, posterCard: 150, minTile: 150 }
    : { gutter: 16, gap: 10, wideCard: 220, posterCard: 112, minTile: 100 }

/**
 * A poster grid (Movies, Shows, My list, categories, §13.4): as many columns of at least
 * `minTile` as fit, never fewer than 3, and the width of each tile.
 */
export const gridOf = (width: number): { columns: number; tile: number; gap: number } => {
  const { gutter, gap, minTile } = metricsOf(sizeClassOf(width))
  const inner = Math.max(0, width - 2 * gutter)
  const columns = Math.max(3, Math.floor((inner + gap) / (minTile + gap)))
  return { columns, tile: (inner - gap * (columns - 1)) / columns, gap }
}
