// Artwork shown by the site's scripts. Images placed in the HTML are referenced there directly.
// Backdrops come from the app (apps/web), the fictional film frames from design/sample-library
// (original images, no real titles).
import city from '../../web/src/shared/backdrops/city.webp'
import dunes from '../../web/src/shared/backdrops/dunes.webp'
import mountains from '../../web/src/shared/backdrops/mountains.webp'
import ocean from '../../web/src/shared/backdrops/ocean.webp'
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
