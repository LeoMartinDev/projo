// Artwork shown by the site's scripts. Images placed in the HTML are referenced there directly.
// Backdrops come from the app (apps/web), the fictional film frames from design/sample-library
// (original images, no real titles).
import city from '@projo/design/backdrops/city.webp'
import dunes from '@projo/design/backdrops/dunes.webp'
import mountains from '@projo/design/backdrops/mountains.webp'
import ocean from '@projo/design/backdrops/ocean.webp'
import ferry from '../../../design/sample-library/thumbnails/ferry.webp'
import marees from '../../../design/sample-library/thumbnails/marees.webp'
import minuit from '../../../design/sample-library/thumbnails/minuit.webp'
import nord from '../../../design/sample-library/thumbnails/nord.webp'
import orbite from '../../../design/sample-library/thumbnails/orbite.webp'
import tilleuls from '../../../design/sample-library/thumbnails/tilleuls.webp'

export const wallImages = [
  nord,
  marees,
  dunes,
  minuit,
  orbite,
  ocean,
  ferry,
  tilleuls,
  mountains,
  city,
] as const
