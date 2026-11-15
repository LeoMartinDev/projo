import { expect, test } from 'bun:test'

import { imageWidths } from '@projo/shared/api/catalog'

import { resolveMediaUrl } from '../api/media-url.ts'
import { artworkSources } from './Artwork.tsx'

const desktop = resolveMediaUrl({ serverOrigin: 'http://nas.local:8080', mediaKey: 'k' })

test('offers the width ladder of a server image, as it is in the browser', () => {
  const sources = artworkSources('/api/v1/images/a', '100vw', resolveMediaUrl({ serverOrigin: '' }))
  expect(sources.src).toBe('/api/v1/images/a')
  expect(sources.sizes).toBe('100vw')
  expect(sources.srcSet).toBe(imageWidths.map((w) => `/api/v1/images/a?w=${w} ${w}w`).join(', '))
})

test('tests the path before resolving it, then joins the width and the key', () => {
  const sources = artworkSources('/api/v1/images/a', '100vw', desktop)
  expect(sources.src).toBe('http://nas.local:8080/api/v1/images/a?key=k')
  expect(sources.srcSet?.split(', ')[0]).toBe(
    `http://nas.local:8080/api/v1/images/a?w=${imageWidths[0]}&key=k ${imageWidths[0]}w`,
  )
})

test('resolves any other picture without a ladder', () => {
  expect(artworkSources('/api/v1/trickplay/s/0.jpg', 'auto', desktop)).toEqual({
    src: 'http://nas.local:8080/api/v1/trickplay/s/0.jpg?key=k',
  })
  expect(artworkSources('https://image.tmdb.org/a.jpg', 'auto', desktop)).toEqual({
    src: 'https://image.tmdb.org/a.jpg',
  })
})
