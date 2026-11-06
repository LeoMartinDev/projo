// The wall behind the homepage title: 640 px tiles generated from the originals listed in
// src/photos.ts (wallPhotos) by scripts/images.ts. Photos placed in the pages come from
// pageContext's `photo` instead.
import city from '../generated/wall/city.webp'
import dunes from '../generated/wall/dunes.webp'
import ferry from '../generated/wall/ferry.webp'
import lanternes from '../generated/wall/lanternes.webp'
import lanternesAtelier from '../generated/wall/lanternesAtelier.webp'
import lanternesPont from '../generated/wall/lanternesPont.webp'
import marees from '../generated/wall/marees.webp'
import minuit from '../generated/wall/minuit.webp'
import mountains from '../generated/wall/mountains.webp'
import nord from '../generated/wall/nord.webp'
import ocean from '../generated/wall/ocean.webp'
import orbite from '../generated/wall/orbite.webp'
import tilleuls from '../generated/wall/tilleuls.webp'

export const wallImages = [
  nord,
  lanternesAtelier,
  marees,
  dunes,
  minuit,
  lanternes,
  orbite,
  ocean,
  ferry,
  lanternesPont,
  tilleuls,
  mountains,
  city,
] as const
