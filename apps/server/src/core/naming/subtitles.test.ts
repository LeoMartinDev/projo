import { describe, expect, test } from 'bun:test'

import { normalizeLanguage } from './languages'
import { matchExternalSubtitles, parseSubtitleTags } from './subtitles'

describe('normalizeLanguage', () => {
  test.each([
    ['fr', 'fr'],
    ['FRE', 'fr'],
    ['fra', 'fr'],
    ['French', 'fr'],
    ['Français', 'fr'],
    ['francais', 'fr'],
    ['pt-BR', 'pt-BR'],
    ['pt_br', 'pt-BR'],
    ['es-419', 'es-419'],
    ['jpn', 'ja'],
    ['chi', 'zh'],
    ['zho', 'zh'],
    ['ger', 'de'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeLanguage(raw)).toBe(expected)
  })

  test.each(['und', 'xx', 'Commentary', 'fr-BR-x', ''])('inconnu : %s', (raw) => {
    expect(normalizeLanguage(raw)).toBeUndefined()
  })
})

describe('parseSubtitleTags', () => {
  test('ordre libre, flags cumulables', () => {
    expect(parseSubtitleTags(['forced', 'default', 'fr'])).toEqual({
      language: 'fr',
      forced: true,
      sdh: false,
      isDefault: true,
    })
  })

  test('une seconde langue va au titre', () => {
    expect(parseSubtitleTags(['en', 'fr'])).toEqual({
      language: 'en',
      forced: false,
      sdh: false,
      isDefault: false,
      title: 'fr',
    })
  })
})

describe('matchExternalSubtitles', () => {
  test('choisit la vidéo au nom le plus long', () => {
    const result = matchExternalSubtitles({
      videoPaths: ['Film.mkv', 'Film.Part2.mkv'],
      subtitlePaths: ['Film.Part2.fr.srt', 'Film.fr.srt'],
    })
    expect(result.map((s) => [s.subtitlePath, s.videoPath])).toEqual([
      ['Film.Part2.fr.srt', 'Film.Part2.mkv'],
      ['Film.fr.srt', 'Film.mkv'],
    ])
  })

  test('nom insensible à la casse', () => {
    expect(
      matchExternalSubtitles({
        videoPaths: ['Show/S01E01.mkv'],
        subtitlePaths: ['Show/s01e01.FR.srt'],
      })[0]?.language,
    ).toBe('fr')
  })

  test('sous-titre sans vidéo correspondante : ignoré', () => {
    expect(
      matchExternalSubtitles({
        videoPaths: ['A/Film.mkv'],
        subtitlePaths: ['B/Film.fr.srt', 'A/Autre.fr.srt'],
      }),
    ).toEqual([])
  })

  test('Subs/ imbriqué et noms avec flags', () => {
    const result = matchExternalSubtitles({
      videoPaths: ['Film (2010)/Film.mkv'],
      subtitlePaths: [
        'Film (2010)/Subs/Film/3_English_SDH.srt',
        'Film (2010)/Subs/4_French_Forced.srt',
      ],
    })
    expect(result.map(({ language, sdh, forced }) => ({ language, sdh, forced }))).toEqual([
      { language: 'en', sdh: true, forced: false },
      { language: 'fr', sdh: false, forced: true },
    ])
  })

  test('Subs/ sans vidéo dans le dossier parent : ignoré', () => {
    expect(
      matchExternalSubtitles({
        videoPaths: ['Film/Film.mkv'],
        subtitlePaths: ['Ailleurs/Subs/English.srt'],
      }),
    ).toEqual([])
  })
})
