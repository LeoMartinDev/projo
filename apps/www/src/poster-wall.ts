// The tilted, slowly drifting wall of artwork behind the homepage title. Pure layout first
// (testable), then a small DOM renderer. Each column repeats its tiles twice so the CSS
// drift (translateY -50%) loops without a seam.

export type WallTile = { src: string; position: string }
export type WallColumn = { reverse: boolean; offset: number; tiles: WallTile[] }

const positions = ['22% 50%', '50% 50%', '78% 50%', '36% 50%', '64% 50%'] as const

export const wallColumns = ({
  images,
  columns,
  rows,
}: {
  images: readonly string[]
  columns: number
  rows: number
}): WallColumn[] =>
  Array.from({ length: columns }, (_, column) => {
    const tiles = Array.from({ length: rows }, (_, row) => ({
      src: images[(column * 5 + row * 7) % images.length] ?? '',
      position: positions[(column + row * 2) % positions.length] ?? '50% 50%',
    }))
    return {
      reverse: column % 2 === 1,
      offset: -((column * 83) % 240),
      tiles: [...tiles, ...tiles],
    }
  })

export const renderWall = (container: HTMLElement, columns: readonly WallColumn[]) => {
  const fragment = document.createDocumentFragment()
  for (const column of columns) {
    const element = document.createElement('div')
    element.className = column.reverse ? 'wall__column wall__column--reverse' : 'wall__column'
    element.style.marginTop = `${column.offset}px`
    for (const tile of column.tiles) {
      const image = document.createElement('img')
      image.className = 'wall__tile'
      image.src = tile.src
      image.alt = ''
      image.decoding = 'async'
      image.style.objectPosition = tile.position
      element.append(image)
    }
    fragment.append(element)
  }
  container.replaceChildren(fragment)
}
