import { describe, expect, test } from 'bun:test'
import i18next, { type TFunction } from 'i18next'

import { resources } from '../../../shared/i18n/index.ts'
import { jobTargetLabel } from './job-types.ts'

const translator = async (lng: 'fr' | 'en'): Promise<TFunction> => {
  const instance = i18next.createInstance()
  await instance.init({ resources, lng, interpolation: { escapeValue: false } })
  return instance.t
}

describe('job target line (§15 "Jobs")', () => {
  test('an episode target is composed in the interface language', async () => {
    const target = {
      kind: 'item',
      id: 'e',
      item: { kind: 'episode', seriesTitle: 'Severance', seasonNumber: 2, episodeNumber: 4 },
    } as const
    expect(jobTargetLabel(await translator('fr'), target)).toBe('Severance · S2 · É4')
    expect(jobTargetLabel(await translator('en'), target)).toBe('Severance · S2 · E4')
  })

  test('a season target, a movie target', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    const season = {
      kind: 'season',
      id: 's',
      item: { kind: 'season', seriesTitle: 'Severance', seasonNumber: 0 },
    } as const
    expect(jobTargetLabel(fr, season)).toBe('Severance · Épisodes spéciaux')
    expect(jobTargetLabel(en, season)).toBe('Severance · Specials')
    expect(
      jobTargetLabel(fr, { kind: 'item', id: 'm', item: { kind: 'movie', title: 'Dune' } }),
    ).toBe('Dune')
  })

  test('a library, file or version by its name; a target gone', async () => {
    const fr = await translator('fr')
    const en = await translator('en')
    expect(jobTargetLabel(fr, { kind: 'source', id: 'x', label: 'Dune (2021).mkv' })).toBe(
      'Dune (2021).mkv',
    )
    expect(jobTargetLabel(fr, { kind: 'library', id: 'lib-1' })).toBe('Supprimé (lib-1)')
    expect(jobTargetLabel(en, { kind: 'library', id: 'lib-1' })).toBe('Deleted (lib-1)')
  })
})
