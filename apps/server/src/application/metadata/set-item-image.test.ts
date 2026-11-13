import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'
import { maxImageUploadBytes } from '@projo/shared/api/metadata'

import { tmdbFailure } from '../../../test/support/metadata-fakes.ts'
import {
  JPEG,
  NOT_AN_IMAGE,
  notFound,
  now,
  poster,
  createEditingWorld as setup,
  storedImage,
} from '../../../test/support/metadata-editing-world.ts'
import type { TmdbApi } from '../../core/metadata/tmdb.ts'

describe('choosing a TMDB image', () => {
  const tmdbImages: Partial<TmdbApi> = {
    images: async () =>
      ok({
        posters: [poster('/chosen.jpg', { language: 'en', width: 1000, height: 1500 })],
        backdrops: [],
        logos: [],
      }),
    downloadImage: async () => ok({ bytes: JPEG, contentType: 'image/png' }),
  }

  test('downloaded, stored with its variants, locked; the previous file goes', async () => {
    const world = setup({
      tmdb: tmdbImages,
      slots: { 'movie:poster': 'old' },
      storedImages: [storedImage('old', { tmdbPath: '/old.jpg' })],
    })
    const result = await world.setItemImage({
      itemId: 'movie',
      choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
    })

    expect(world.tmdbCallsTo('downloadImage')).toEqual([{ path: '/chosen.jpg', size: 'w500' }])
    expect(world.written).toEqual(['posters/img-1.png'])
    expect(world.encoded).toEqual(['posters/img-1.png'])
    expect(world.inserted).toEqual([
      {
        id: 'img-1',
        kind: 'poster',
        origin: 'tmdb',
        tmdbPath: '/chosen.jpg',
        localPath: 'posters/img-1.png',
        width: 500,
        height: 750,
        language: 'en',
      },
    ])
    expect(world.overridesSet).toEqual([
      { itemId: 'movie', overrides: { posterImageId: 'img-1' }, at: now },
    ])
    expect(world.deleteAsked).toEqual(['old'])
    expect(world.removedFiles).toEqual(['posters/old.jpg'])
    expect(world.images.has('old')).toBe(false)
    expect(world.events).toEqual([{ type: 'catalog.changed', payload: {} }])
    expect(result.ok && result.value.locked).toEqual(['poster'])
  })

  test('the previous image still shown elsewhere stays, with its file', async () => {
    for (const elsewhere of [
      { slots: { 'other:backdrop': 'shared' } },
      { profileImages: ['shared'] },
      { storedOverrides: { other: { posterImageId: 'shared' } } },
    ]) {
      const world = setup({
        tmdb: tmdbImages,
        storedImages: [storedImage('shared')],
        ...elsewhere,
        slots: { 'movie:poster': 'shared', ...('slots' in elsewhere ? elsewhere.slots : {}) },
      })
      expect(
        (
          await world.setItemImage({
            itemId: 'movie',
            choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
          })
        ).ok,
      ).toBe(true)
      expect(world.deleteAsked).toEqual(['shared'])
      expect(world.images.has('shared')).toBe(true)
      expect(world.removedFiles).toEqual([])
    }
  })

  test('an unknown item: item/not_found, nothing downloaded', async () => {
    const world = setup({ tmdb: tmdbImages })
    expect(
      await world.setItemImage({
        itemId: 'nope',
        choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
      }),
    ).toMatchObject(notFound)
    expect(world.tmdbCallsTo('downloadImage')).toEqual([])
  })

  test('a backdrop is downloaded at w1280 into backdrops/, its extension from the path', async () => {
    const world = setup({
      tmdb: {
        downloadImage: async () => ok({ bytes: JPEG, contentType: 'application/octet-stream' }),
      },
    })
    await world.setItemImage({
      itemId: 'movie',
      choice: { kind: 'backdrop', tmdbPath: '/wide.WEBP' },
    })
    expect(world.tmdbCallsTo('downloadImage')).toEqual([{ path: '/wide.WEBP', size: 'w1280' }])
    expect(world.written).toEqual(['backdrops/img-1.webp'])
    expect(world.overridesSet[0]?.overrides).toEqual({ backdropImageId: 'img-1' })
  })

  test('a local item: metadata/not_matched, nothing downloaded', async () => {
    const world = setup({ tmdb: tmdbImages })
    expect(
      await world.setItemImage({
        itemId: 'local',
        choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'metadata/not_matched' } })
    expect(world.tmdbCallsTo('downloadImage')).toEqual([])
  })

  test('a failed download stores nothing', async () => {
    const world = setup({ tmdb: { downloadImage: async () => tmdbFailure() } })
    expect(
      await world.setItemImage({
        itemId: 'movie',
        choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'metadata/tmdb_unavailable' } })
    expect(world.inserted).toEqual([])
    expect(world.overridesSet).toEqual([])
    expect(world.events).toEqual([])
  })

  test('a file that cannot be written stores nothing', async () => {
    const world = setup({ tmdb: tmdbImages, writeFails: true })
    expect(
      await world.setItemImage({
        itemId: 'movie',
        choice: { kind: 'poster', tmdbPath: '/chosen.jpg' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'metadata/image_failed' } })
    expect(world.encoded).toEqual([])
    expect(world.inserted).toEqual([])
  })
})

describe('uploading an image', () => {
  const upload = (bytes: Uint8Array, sizeBytes = bytes.byteLength) => ({
    itemId: 'movie',
    choice: { kind: 'poster' as const, upload: { bytes, sizeBytes } },
  })

  test('an unknown item: item/not_found', async () => {
    expect(await setup().setItemImage({ ...upload(JPEG), itemId: 'nope' })).toMatchObject(notFound)
  })

  test('over 10 MB: image/too_large, before reading it', async () => {
    const world = setup()
    expect(await world.setItemImage(upload(JPEG, maxImageUploadBytes + 1))).toMatchObject({
      ok: false,
      error: {
        code: 'image/too_large',
        context: { sizeBytes: maxImageUploadBytes + 1, maxBytes: maxImageUploadBytes },
      },
    })
    expect(world.written).toEqual([])
  })

  test('not a JPEG, PNG or WebP: image/unsupported_type', async () => {
    expect(await setup().setItemImage(upload(NOT_AN_IMAGE))).toMatchObject({
      ok: false,
      error: { code: 'image/unsupported_type' },
    })
  })

  test('a re-encoding failure is returned and nothing is stored', async () => {
    const world = setup({
      reencoder: { reencode: async () => err(appError('image/unreadable', 'corrupt image')) },
    })
    expect(await world.setItemImage(upload(JPEG))).toMatchObject({
      ok: false,
      error: { code: 'image/unreadable' },
    })
    expect(world.inserted).toEqual([])
  })

  test('re-encoded into images/custom and locked; the previous custom image goes', async () => {
    const world = setup({
      slots: { 'movie:poster': 'mine' },
      storedImages: [storedImage('mine', { origin: 'custom', localPath: 'custom/mine.jpg' })],
    })
    const result = await world.setItemImage(upload(JPEG))
    expect(world.written).toEqual(['custom/img-1.webp'])
    expect(world.encoded).toEqual(['custom/img-1.webp'])
    expect(world.inserted).toEqual([
      {
        id: 'img-1',
        kind: 'poster',
        origin: 'custom',
        localPath: 'custom/img-1.webp',
        width: 600,
        height: 900,
      },
    ])
    expect(world.overridesSet).toEqual([
      { itemId: 'movie', overrides: { posterImageId: 'img-1' }, at: now },
    ])
    expect(world.deleteAsked).toEqual(['mine'])
    expect(world.removedFiles).toEqual(['custom/mine.jpg'])
    expect(result.ok && result.value.locked).toEqual(['poster'])
  })
})
