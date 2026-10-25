import { describe, expect, test } from 'bun:test'

import type { AudioTrackDto, SubtitleTrackDto } from '@projo/shared/api/playback'

import {
  memoryAtOpen,
  preferencesOf,
  profileDefaultsFor,
  selectionOf,
  serialTasks,
  toastForChange,
  toastHideDelay,
  undoActionFor,
} from './track-memory.ts'

const audio = (index: number, language?: string): AudioTrackDto => ({
  index,
  codec: 'aac',
  isDefault: index === 1,
  ...(language === undefined ? {} : { language }),
})

const subtitle = (id: string, language?: string): SubtitleTrackDto => ({
  id,
  origin: 'embedded',
  format: 'subrip',
  forced: false,
  sdh: false,
  isDefault: false,
  delivery: 'vtt',
  ...(language === undefined ? {} : { language }),
})

describe('preferencesOf', () => {
  test('languages of the chosen tracks, `und` left out', () => {
    expect(preferencesOf({ audio: audio(1, 'jpn'), subtitle: subtitle('s', 'fre') })).toEqual({
      audioLanguage: 'jpn',
      subtitleLanguage: 'fre',
      subtitlesEnabled: true,
    })
    expect(preferencesOf({ audio: audio(1, 'und'), subtitle: undefined })).toEqual({
      subtitlesEnabled: false,
    })
  })

  test('the memory at open is known only when the server used it', () => {
    const session = {
      audioTracks: [audio(1, 'eng'), audio(2, 'fre')],
      selectedAudioStreamIndex: 2,
      subtitleTracks: [subtitle('s', 'eng')],
    }
    expect(memoryAtOpen({ ...session, trackSelection: 'memory' })).toEqual({
      audioLanguage: 'fre',
      subtitlesEnabled: false,
    })
    expect(memoryAtOpen({ ...session, trackSelection: 'profile' })).toBeUndefined()
  })

  test('after an audio change left to the cascade, the memory is what the new session shows', () => {
    // `when_audio_differs` turned the French subtitles on for the English audio.
    const session = {
      audioTracks: [audio(1, 'fre'), audio(2, 'eng')],
      selectedAudioStreamIndex: 2,
      subtitleTracks: [subtitle('s-fr', 'fre')],
      selectedSubtitleTrackId: 's-fr',
    }
    expect(preferencesOf(selectionOf(session))).toEqual({
      audioLanguage: 'eng',
      subtitleLanguage: 'fre',
      subtitlesEnabled: true,
    })
  })
})

describe('serialTasks', () => {
  test('a write starts once the previous one settled, even a failed one', async () => {
    const run = serialTasks()
    const log: string[] = []
    let releaseFirst = () => {}
    const first = run(async () => {
      log.push('put start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      log.push('put end')
      throw new Error('offline')
    })
    const second = run(async () => {
      log.push('delete')
      return 'deleted'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log).toEqual(['put start'])
    releaseFirst()
    await expect(first).rejects.toThrow('offline')
    expect(await second).toBe('deleted')
    expect(log).toEqual(['put start', 'put end', 'delete'])
  })
})

describe('undo and profile defaults', () => {
  test('Annuler restores the previous memory, or deletes the new one', () => {
    expect(undoActionFor(undefined)).toEqual({ type: 'delete' })
    expect(undoActionFor({ subtitlesEnabled: false })).toEqual({
      type: 'restore',
      body: { subtitlesEnabled: false },
    })
  })

  test('the profile gets the changed type only', () => {
    const memory = { audioLanguage: 'jpn', subtitleLanguage: 'fre', subtitlesEnabled: true }
    expect(profileDefaultsFor('audio', memory, { subtitleMode: 'never' })).toEqual({
      audioLanguage: 'ja',
    })
    expect(profileDefaultsFor('subtitles', memory, { subtitleMode: 'never' })).toEqual({
      subtitleLanguage: 'fr',
      subtitleMode: 'always',
    })
    expect(profileDefaultsFor('subtitles', memory, { subtitleMode: 'when_audio_differs' })).toEqual(
      { subtitleLanguage: 'fr' },
    )
    expect(
      profileDefaultsFor('subtitles', { subtitlesEnabled: false }, { subtitleMode: 'always' }),
    ).toEqual({ subtitleMode: 'never' })
    expect(
      profileDefaultsFor('audio', { subtitlesEnabled: false }, { subtitleMode: 'always' }),
    ).toBeUndefined()
    expect(
      profileDefaultsFor(
        'audio',
        { audioLanguage: 'pt-BR', subtitlesEnabled: false },
        { subtitleMode: 'always' },
      ),
    ).toEqual({ audioLanguage: 'pt' })
    expect(
      profileDefaultsFor(
        'subtitles',
        { subtitleLanguage: 'fre', subtitlesEnabled: true },
        { subtitleMode: 'always' },
      ),
    ).toEqual({ subtitleLanguage: 'fr' })
    expect(
      profileDefaultsFor(
        'audio',
        { audioLanguage: 'x1', subtitlesEnabled: false },
        { subtitleMode: 'always' },
      ),
    ).toBeUndefined()
  })
})

describe('toast', () => {
  test('a burst of changes keeps the memory from before the first one', () => {
    const first = toastForChange({
      previousToast: undefined,
      memory: undefined,
      kind: 'audio',
      scope: 'series',
      current: { audioLanguage: 'jpn', subtitlesEnabled: false },
    })
    expect(first).toMatchObject({ id: 1, previous: undefined, status: 'applied' })
    const second = toastForChange({
      previousToast: first,
      memory: first.current,
      kind: 'subtitles',
      scope: 'series',
      current: { audioLanguage: 'jpn', subtitleLanguage: 'fre', subtitlesEnabled: true },
    })
    expect(second).toMatchObject({ id: 2, previous: undefined, kind: 'subtitles' })
    const later = toastForChange({
      previousToast: { ...second, status: 'defaulted' },
      memory: second.current,
      kind: 'audio',
      scope: 'series',
      current: { audioLanguage: 'fre', subtitlesEnabled: true },
    })
    expect(later.previous).toEqual(second.current)
  })

  test('stays 8 s, a confirmation 2.5 s, forever while saving', () => {
    const toast = toastForChange({
      previousToast: undefined,
      memory: undefined,
      kind: 'audio',
      scope: 'movie',
      current: { subtitlesEnabled: false },
    })
    expect(toastHideDelay(toast)).toBe(8000)
    expect(toastHideDelay({ ...toast, status: 'defaulting' })).toBeUndefined()
    expect(toastHideDelay({ ...toast, status: 'undone' })).toBe(2500)
  })
})
