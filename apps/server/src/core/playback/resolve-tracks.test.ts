import { describe, expect, test } from 'bun:test'

import type { AudioStreamInfo } from './media-info.ts'
import {
  equivalentSubtitle,
  languageBase,
  type ProfileTrackDefaults,
  resolveTracks,
  type ResolveTracksInput,
} from './resolve-tracks.ts'
import type { SubtitleTrack } from './subtitles.ts'

const audio = (index: number, extra: Partial<AudioStreamInfo> = {}): AudioStreamInfo => ({
  index,
  codec: 'aac',
  isDefault: false,
  ...extra,
})

const sub = (id: string, extra: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  id,
  sourceId: 'source-1',
  origin: 'embedded',
  forced: false,
  sdh: false,
  isDefault: false,
  format: 'srt',
  ...extra,
})

const french: ProfileTrackDefaults = {
  audioLanguage: 'fr',
  subtitleLanguage: 'fr',
  subtitleMode: 'when_audio_differs',
  animeOriginalAudio: true,
}

const resolve = (input: Partial<ResolveTracksInput>) => {
  const result = resolveTracks({
    audio: [],
    subtitles: [],
    profile: french,
    burnInEnabled: true,
    ...input,
  })
  if (!result.ok) throw new Error(result.error.code)
  return {
    audio: result.value.audio?.index,
    subtitle: result.value.subtitle?.id,
    burnIn: result.value.burnIn,
    origin: result.value.origin,
  }
}

const vf = audio(1, { language: 'fr' })
const vo = audio(2, { language: 'en', isDefault: true })
const frSub = sub('fr', { language: 'fr' })
const frForced = sub('fr-forced', { language: 'fr', forced: true })
const enSub = sub('en', { language: 'en' })
/** A Japanese animated work (§11.1). */
const anime = { originalLanguage: 'ja', genres: ['animation', 'adventure'] }

describe('languageBase', () => {
  test('639-1, 639-2, regions and names compare equal; und is untagged', () => {
    expect(['fr', 'fre', 'fra', 'fr-FR', 'French'].map(languageBase)).toEqual([
      'fr',
      'fr',
      'fr',
      'fr',
      'fr',
    ])
    expect([undefined, '', 'und', 'UND'].map(languageBase)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe('resolveTracks: audio (§11.2)', () => {
  test('the wanted language wins over the default track', () => {
    expect(resolve({ audio: [vo, vf] })).toMatchObject({ audio: 1, origin: 'profile' })
  })

  test('several tracks in the language: the default one, then the most channels', () => {
    const stereo = audio(1, { language: 'fr', channels: 2 })
    const surround = audio(2, { language: 'fr', channels: 6 })
    const flagged = audio(3, { language: 'fr', channels: 2, isDefault: true })
    expect(resolve({ audio: [stereo, surround] }).audio).toBe(2)
    expect(resolve({ audio: [stereo, surround, flagged] }).audio).toBe(3)
  })

  test('a 639-2 tag or a profile in 639-2 matches', () => {
    expect(resolve({ audio: [vo, audio(4, { language: 'fre' })] }).audio).toBe(4)
    expect(resolve({ audio: [vo, vf], profile: { ...french, audioLanguage: 'fra' } }).audio).toBe(1)
  })

  test('no track in the language: the original language of the work', () => {
    const de = audio(1, { language: 'de', isDefault: true })
    const it = audio(2, { language: 'it' })
    expect(resolve({ audio: [de, it], originalLanguage: 'it' }).audio).toBe(2)
  })

  test('neither: the default track, else the first', () => {
    const de = audio(1, { language: 'de' })
    const it = audio(2, { language: 'it', isDefault: true })
    expect(resolve({ audio: [de, it] }).audio).toBe(2)
    expect(resolve({ audio: [de, { ...it, isDefault: false }] }).audio).toBe(1)
  })

  test('an untagged track is not chosen over a tagged one, even flagged default', () => {
    const und = audio(1, { isDefault: true })
    const de = audio(2, { language: 'de' })
    expect(resolve({ audio: [und, de] }).audio).toBe(2)
    expect(resolve({ audio: [audio(1, { language: 'und', isDefault: true }), de] }).audio).toBe(2)
  })

  test('the only track plays, tagged or not; all untagged: the default, else the first', () => {
    expect(resolve({ audio: [audio(5)] }).audio).toBe(5)
    expect(resolve({ audio: [audio(1), audio(2, { isDefault: true })] }).audio).toBe(2)
    expect(resolve({ audio: [audio(1), audio(2)] }).audio).toBe(1)
  })

  test('no audio track: none', () => {
    expect(resolve({ audio: [] }).audio).toBeUndefined()
  })
})

describe('resolveTracks: subtitles (§11.2)', () => {
  test('never: none, even a forced track', () => {
    const profile = { ...french, subtitleMode: 'never' as const }
    expect(resolve({ profile, audio: [vo], subtitles: [frForced, frSub] }).subtitle).toBeUndefined()
  })

  test('always: a track in the preferred language, even with the audio in that language', () => {
    const profile = { ...french, subtitleMode: 'always' as const }
    expect(resolve({ profile, audio: [vf], subtitles: [enSub, frSub] }).subtitle).toBe('fr')
  })

  test('when_audio_differs, audio in another language: the full track', () => {
    expect(resolve({ audio: [vo], subtitles: [frForced, enSub, frSub] })).toMatchObject({
      audio: 2,
      subtitle: 'fr',
    })
  })

  test('when_audio_differs, audio in the preferred language: only a forced one', () => {
    expect(resolve({ audio: [vf, vo], subtitles: [frSub, frForced] }).subtitle).toBe('fr-forced')
    expect(resolve({ audio: [vf, vo], subtitles: [frSub, enSub] }).subtitle).toBeUndefined()
  })

  test('forced_only: a forced track of the language, whatever the audio', () => {
    const profile = { ...french, subtitleMode: 'forced_only' as const }
    expect(resolve({ profile, audio: [vo], subtitles: [frSub, frForced] }).subtitle).toBe(
      'fr-forced',
    )
    expect(resolve({ profile, audio: [vo], subtitles: [frSub] }).subtitle).toBeUndefined()
    // A forced track of another language does not count.
    const enForced = sub('en-forced', { language: 'en', forced: true })
    expect(resolve({ profile, audio: [vo], subtitles: [enForced] }).subtitle).toBeUndefined()
  })

  test('preference order: full before forced, external before embedded, non-SDH before SDH', () => {
    const embedded = sub('embedded', { language: 'fr' })
    const external = sub('external', { language: 'fr', origin: 'external' })
    const externalSdh = sub('external-sdh', { language: 'fr', origin: 'external', sdh: true })
    const externalForced = sub('external-forced', {
      language: 'fr',
      origin: 'external',
      forced: true,
    })
    const pick = (subtitles: SubtitleTrack[]) => resolve({ audio: [vo], subtitles }).subtitle
    expect(pick([embedded, externalForced, externalSdh, external])).toBe('external')
    expect(pick([embedded, externalForced, externalSdh])).toBe('external-sdh')
    expect(pick([embedded, externalForced])).toBe('embedded')
    expect(pick([externalForced])).toBe('external-forced')
    expect(pick([embedded, sub('embedded-sdh', { language: 'fr', sdh: true })])).toBe('embedded')
    // Among forced tracks too: external first, then non-SDH.
    const forcedSdh = sub('forced-sdh', { language: 'fr', forced: true, sdh: true })
    expect(resolve({ audio: [vf], subtitles: [forcedSdh, frForced] }).subtitle).toBe('fr-forced')
  })

  test('an untagged track is chosen only when it is the only subtitle track', () => {
    const untagged = sub('untagged')
    expect(resolve({ audio: [vo], subtitles: [untagged] }).subtitle).toBe('untagged')
    expect(resolve({ audio: [vo], subtitles: [untagged, enSub] }).subtitle).toBeUndefined()
    expect(
      resolve({ audio: [vo], subtitles: [sub('und', { language: 'und' }), enSub] }).subtitle,
    ).toBeUndefined()
    // Not when only forced subtitles are wanted.
    expect(resolve({ audio: [vf], subtitles: [untagged] }).subtitle).toBeUndefined()
  })

  test('audio of unknown language counts as the preferred one (forced only)', () => {
    expect(resolve({ audio: [audio(1)], subtitles: [frSub, frForced] }).subtitle).toBe('fr-forced')
  })

  test('the subtitle language is matched across 639 forms', () => {
    expect(resolve({ audio: [vo], subtitles: [sub('fre', { language: 'fre' })] }).subtitle).toBe(
      'fre',
    )
  })
})

describe('resolveTracks: bitmap tracks (§10.4)', () => {
  const pgs = sub('pgs', { language: 'fr', format: 'pgs' })

  test('chosen and burnt in when burn-in is on', () => {
    expect(resolve({ audio: [vo], subtitles: [pgs] })).toMatchObject({
      subtitle: 'pgs',
      burnIn: true,
    })
    // A text track of the same language is preferred only by the usual order.
    expect(resolve({ audio: [vo], subtitles: [pgs, frSub] })).toMatchObject({
      subtitle: 'pgs',
      burnIn: true,
    })
    expect(
      resolve({ audio: [vo], subtitles: [pgs, { ...frSub, origin: 'external' }] }),
    ).toMatchObject({ subtitle: 'fr', burnIn: false })
  })

  test('burn-in off: never chosen automatically, a text track is taken instead', () => {
    expect(resolve({ audio: [vo], subtitles: [pgs], burnInEnabled: false })).toMatchObject({
      subtitle: undefined,
      burnIn: false,
    })
    expect(resolve({ audio: [vo], subtitles: [pgs, frSub], burnInEnabled: false }).subtitle).toBe(
      'fr',
    )
  })

  test('burn-in off and asked explicitly: refused', () => {
    expect(
      resolveTracks({
        audio: [vo],
        subtitles: [pgs],
        profile: french,
        burnInEnabled: false,
        explicit: { subtitle: { trackId: 'pgs' } },
      }),
    ).toMatchObject({ ok: false, error: { code: 'playback/subtitle_unsupported' } })
  })
})

describe('resolveTracks: the anime rule (§11.1)', () => {
  const ja = audio(1, { language: 'ja' })
  const dub = audio(2, { language: 'fr', isDefault: true })

  test('an anime: original audio and subtitles in the preferred language', () => {
    expect(resolve({ audio: [dub, ja], subtitles: [frForced, frSub], ...anime })).toEqual({
      audio: 1,
      subtitle: 'fr',
      burnIn: false,
      origin: 'anime',
    })
  })

  test('applies even when the profile never shows subtitles', () => {
    const profile = { ...french, subtitleMode: 'never' as const }
    expect(
      resolve({
        profile,
        audio: [dub, ja],
        subtitles: [frSub],
        ...anime,
        originalLanguage: 'ja-JP',
      }),
    ).toMatchObject({ audio: 1, subtitle: 'fr', origin: 'anime' })
  })

  test('off in the profile, or not an anime: the profile defaults', () => {
    const profile = { ...french, animeOriginalAudio: false }
    expect(resolve({ profile, audio: [dub, ja], subtitles: [frSub], ...anime })).toMatchObject({
      audio: 2,
      subtitle: undefined,
      origin: 'profile',
    })
    expect(
      resolve({ audio: [dub, ja], subtitles: [frSub], ...anime, originalLanguage: 'ko' }),
    ).toMatchObject({ audio: 2, origin: 'profile' })
    // A Japanese live-action film.
    expect(
      resolve({ audio: [dub, ja], subtitles: [frSub], originalLanguage: 'ja', genres: ['drama'] }),
    ).toMatchObject({ audio: 2, subtitle: undefined, origin: 'profile' })
    // Genres unknown.
    expect(resolve({ audio: [dub, ja], subtitles: [frSub], originalLanguage: 'ja' })).toMatchObject(
      { audio: 2, origin: 'profile' },
    )
  })

  test('no Japanese track: the profile language as a fallback is not used, the default is', () => {
    expect(
      resolve({
        audio: [audio(1, { language: 'en', isDefault: true }), audio(2, { language: 'fr' })],
        ...anime,
      }),
    ).toMatchObject({ audio: 1, origin: 'anime' })
  })
})

describe('resolveTracks: the series memory (§11.2 step 1)', () => {
  test('wins over the anime rule and the profile', () => {
    expect(
      resolve({
        audio: [vf, audio(3, { language: 'ja' })],
        subtitles: [frSub, enSub],
        ...anime,
        memory: { audioLanguage: 'fr', subtitlesEnabled: false },
      }),
    ).toEqual({ audio: 1, subtitle: undefined, burnIn: false, origin: 'memory' })
  })

  test('subtitles turned on in a language: that language, whatever the audio', () => {
    expect(
      resolve({
        audio: [vf, vo],
        subtitles: [frSub, enSub],
        memory: { audioLanguage: 'fr', subtitleLanguage: 'en', subtitlesEnabled: true },
      }),
    ).toMatchObject({ audio: 1, subtitle: 'en', origin: 'memory' })
  })

  test('a language absent from the memory: the next level decides that type', () => {
    expect(
      resolve({
        audio: [vf, vo],
        subtitles: [frSub, enSub],
        memory: { subtitlesEnabled: true },
      }),
    ).toMatchObject({ audio: 1, subtitle: 'fr', origin: 'memory' })
    // Audio from the anime rule when the memory only says "subtitles off".
    expect(
      resolve({
        audio: [vf, audio(3, { language: 'ja' })],
        subtitles: [frSub],
        ...anime,
        memory: { subtitlesEnabled: false },
      }),
    ).toMatchObject({ audio: 3, subtitle: undefined, origin: 'memory' })
  })
})

describe('resolveTracks: explicit choice', () => {
  test('audio index and subtitle track named by the request win', () => {
    expect(
      resolve({
        audio: [vf, vo],
        subtitles: [frSub, enSub],
        explicit: { audioStreamIndex: 2, subtitle: { trackId: 'en' } },
      }),
    ).toEqual({ audio: 2, subtitle: 'en', burnIn: false, origin: 'explicit' })
  })

  test('subtitles off explicitly', () => {
    expect(
      resolve({ audio: [vo], subtitles: [frSub], explicit: { subtitle: 'off' } }),
    ).toMatchObject({ audio: 2, subtitle: undefined, origin: 'explicit' })
  })

  test('explicit audio only: the subtitles follow the cascade with that audio', () => {
    expect(
      resolve({ audio: [vf, vo], subtitles: [frSub], explicit: { audioStreamIndex: 2 } }),
    ).toMatchObject({ audio: 2, subtitle: 'fr', origin: 'explicit' })
  })

  test('an index or a track not in the file is ignored', () => {
    expect(
      resolve({
        audio: [vf, vo],
        subtitles: [frSub],
        explicit: { audioStreamIndex: 9, subtitle: { trackId: 'gone' } },
      }),
    ).toMatchObject({ audio: 1, subtitle: undefined, origin: 'profile' })
  })

  test('an explicit bitmap track is burnt in', () => {
    const pgs = sub('pgs', { language: 'en', format: 'pgs' })
    expect(
      resolve({ audio: [vf], subtitles: [pgs], explicit: { subtitle: { trackId: 'pgs' } } }),
    ).toMatchObject({ subtitle: 'pgs', burnIn: true, origin: 'explicit' })
  })
})

describe('resolveTracks: no profile', () => {
  test('default audio, subtitles off', () => {
    expect(
      resolveTracks({ audio: [vf, vo], subtitles: [frSub], burnInEnabled: true }),
    ).toMatchObject({ ok: true, value: { audio: { index: 2 }, origin: 'profile' } })
  })
})

describe('equivalentSubtitle', () => {
  test('same language, forced and SDH; the same origin preferred', () => {
    const tracks = [
      sub('embedded-fr', { language: 'fr' }),
      sub('external-fr', { language: 'fr', origin: 'external' }),
      sub('forced-fr', { language: 'fr', forced: true }),
    ]
    expect(equivalentSubtitle(sub('x', { language: 'fre' }), tracks)?.id).toBe('embedded-fr')
    expect(equivalentSubtitle(sub('x', { language: 'fr', origin: 'external' }), tracks)?.id).toBe(
      'external-fr',
    )
    expect(equivalentSubtitle(sub('x', { language: 'fr', forced: true }), tracks)?.id).toBe(
      'forced-fr',
    )
    expect(equivalentSubtitle(sub('x', { language: 'en' }), tracks)).toBeUndefined()
  })
})
