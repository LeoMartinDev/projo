import { describe, expect, test } from 'bun:test'

import { filterFile, MIN_VIDEO_SIZE_BYTES } from './filters'

const BIG = 50_000_000

describe('filterFile (§7.2 filtre, §7.3 extensions)', () => {
  test.each(['mkv', 'mp4', 'm4v', 'mov', 'avi', 'webm', 'ts', 'm2ts', 'wmv', 'MKV'])(
    'vidéo .%s',
    (extension) => {
      expect(filterFile({ relativePath: `Film.${extension}`, sizeBytes: BIG })).toEqual({
        kind: 'video',
      })
    },
  )

  test.each(['srt', 'ass', 'ssa', 'vtt', 'sub', 'idx', 'sup'])('sous-titre .%s', (extension) => {
    expect(filterFile({ relativePath: `Film.fr.${extension}`, sizeBytes: 10 })).toEqual({
      kind: 'subtitle',
    })
  })

  test.each([
    'Film.mkv.part',
    'Film.mkv.!qB',
    'Film.mkv.!qb',
    'Film.crdownload',
    'Film.mkv.tmp',
    'Film.partial',
    'Film.mkv.aria2',
    'Film.download',
    'Film.mkv.bak',
  ])('incomplet : %s', (relativePath) => {
    expect(filterFile({ relativePath, sizeBytes: BIG })).toEqual({
      kind: 'ignored',
      reason: 'incomplete',
    })
  })

  test.each(['Film.nfo', 'poster.jpg', 'Film.txt', 'Film'])('pas un média : %s', (relativePath) => {
    expect(filterFile({ relativePath, sizeBytes: BIG })).toEqual({
      kind: 'ignored',
      reason: 'not_media',
    })
  })

  test('taille < 1 Mo', () => {
    expect(filterFile({ relativePath: 'Film.mkv', sizeBytes: MIN_VIDEO_SIZE_BYTES - 1 })).toEqual({
      kind: 'ignored',
      reason: 'too_small',
    })
    expect(filterFile({ relativePath: 'Film.mkv', sizeBytes: MIN_VIDEO_SIZE_BYTES })).toEqual({
      kind: 'video',
    })
  })
})
