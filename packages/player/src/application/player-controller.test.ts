import { describe, expect, test } from 'bun:test'

import type {
  AudioTrackDto,
  CreatePlaybackSessionBody,
  PlaybackSessionDto,
  SubtitleTrackDto,
} from '@projo/shared/api/playback'

import type { EngineCapabilities } from '../core/engine.ts'
import { playerFailure } from '../core/failure.ts'
import { createSessionEnds } from '../core/session-ends.ts'
import { createFakePlaybackApi, sessionDto } from '../testing/fake-api.ts'
import { createFakeEngine, fakeClientCapabilities } from '../testing/fake-engine.ts'
import { createManualTimers } from '../testing/manual-timers.ts'
import { endPlaybackSession, createPlayerController } from './player-controller.ts'
import { initialPlayerContext, type PlayerContext } from './player-view.ts'
import { volumeKey } from './volume.ts'

const audio = (index: number, language: string): AudioTrackDto => ({
  index,
  codec: 'aac',
  language,
  isDefault: index === 1,
})

const subtitle = (
  id: string,
  language: string,
  delivery: SubtitleTrackDto['delivery'] = 'vtt',
): SubtitleTrackDto => ({
  id,
  origin: 'external',
  format: 'srt',
  language,
  forced: false,
  sdh: false,
  isDefault: false,
  delivery,
  ...(delivery === 'vtt' ? { url: `/subtitles/${id}.vtt` } : {}),
})

const profile = {
  id: 'profile-1',
  subtitleMode: 'when_audio_differs' as const,
  subtitleLanguage: 'fr',
  autoSkipIntro: false,
  autoplayNext: true,
  autoSkipCredits: false,
}

const world = ({
  session = {},
  capabilities = {},
  answer,
  context = {},
}: {
  session?: Partial<PlaybackSessionDto>
  capabilities?: Partial<EngineCapabilities>
  answer?: (body: CreatePlaybackSessionBody, index: number) => PlaybackSessionDto
  context?: Partial<PlayerContext>
} = {}) => {
  const fake = createFakeEngine({ capabilities })
  const server = createFakePlaybackApi({
    answer:
      answer ??
      ((body, index) =>
        sessionDto(`s${index + 1}`, {
          itemId: body.itemId,
          startPositionMs: body.startPositionMs ?? 0,
          ...(body.sourceId === undefined ? {} : { sourceId: body.sourceId }),
          quality: body.quality ?? 'original',
          ...(body.audioStreamIndex === undefined
            ? {}
            : { selectedAudioStreamIndex: body.audioStreamIndex }),
          ...(body.subtitleTrackId === undefined || body.subtitleTrackId === 'off'
            ? {}
            : { selectedSubtitleTrackId: body.subtitleTrackId }),
          ...session,
        })),
  })
  const clock = createManualTimers()
  const ends = createSessionEnds({
    end: (id, last) => endPlaybackSession(server.api, id, last),
    defer: (callback) => {
      const handle = clock.timers.setTimeout(callback, 0)
      return () => clock.timers.clearTimeout(handle)
    },
  })
  const stored = new Map<string, string>()
  const hide = new Set<() => void>()
  const calls = { letGo: 0, switched: 0, playNext: 0, exit: 0 }
  const controller = createPlayerController({
    itemId: 'item-1',
    fromStart: false,
    engine: fake.engine,
    api: server.api,
    ends,
    timers: clock.timers,
    clock: clock.clock,
    storage: { get: (key) => stored.get(key), set: (key, value) => void stored.set(key, value) },
    page: {
      onHide: (listener) => {
        hide.add(listener)
        return () => void hide.delete(listener)
      },
    },
    subtitleDelayMs: 0,
    onLetGo: () => void (calls.letGo += 1),
    onSwitch: () => void (calls.switched += 1),
    onPlayNext: () => void (calls.playNext += 1),
    onExit: () => void (calls.exit += 1),
  })
  controller.setContext({ ...initialPlayerContext, profile, next: 'none', ...context })
  // Lets promises and zero-delay timers run.
  const settle = async () => {
    for (let round = 0; round < 6; round += 1) {
      clock.advance(0)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  // Moves time: timers, and the media plays along when it is playing.
  const play = async (ms: number) => {
    for (let left = ms; left > 0; left -= 250) {
      const step = Math.min(250, left)
      if (!fake.media().paused) fake.advance(step / 1000)
      clock.advance(step)
    }
    await settle()
  }
  const started = async (durationS = 1200) => {
    controller.start()
    await settle()
    fake.loaded(durationS)
    await settle()
  }
  return { fake, server, clock, controller, calls, stored, hide, settle, play, started }
}

const creations = (bodies: readonly CreatePlaybackSessionBody[]) =>
  bodies.map(({ capabilities: _capabilities, ...body }) => body)

describe('player controller: sessions (§10.6)', () => {
  test('starts a session with the engine capabilities and loads it where it resumes', async () => {
    const w = world({ session: { startPositionMs: 600_000 } })
    w.controller.start()
    expect(w.controller.view().loading).toBe(true)
    await w.settle()
    expect(w.server.created).toEqual([
      { itemId: 'item-1', quality: 'original', capabilities: fakeClientCapabilities },
    ])
    expect(w.fake.commands).toContain('load s1 at 600')
    w.fake.loaded(1200)
    expect(w.fake.media()).toMatchObject({ currentTime: 600, paused: false })
    expect(w.controller.view()).toMatchObject({ positionMs: 600_000, loading: false })
  })

  test('without "from the start", the server picks the resume position', async () => {
    const w = world()
    w.controller.start()
    await w.settle()
    expect(w.server.created[0]?.startPositionMs).toBeUndefined()
  })

  test('heartbeats every interval, at once on pause and seek, not before the media is ready', async () => {
    const w = world()
    await w.started()
    w.server.log.splice(0)
    await w.play(10_000)
    expect(w.server.log).toEqual(['heartbeat s1 10000'])
    w.controller.togglePlay()
    w.controller.seekToItem(30_000)
    await w.settle()
    expect(w.server.log.slice(1)).toEqual([
      'heartbeat s1 10000 paused',
      'heartbeat s1 30000 paused',
    ])
  })

  test('the volume is restored on start and remembered on change', async () => {
    const w = world()
    w.stored.set(volumeKey, JSON.stringify({ volume: 0.4, muted: true }))
    await w.started()
    expect(w.fake.media()).toMatchObject({ volume: 0.4, muted: true })
    w.controller.toggleMute()
    w.controller.setVolume(0.7)
    expect(JSON.parse(w.stored.get(volumeKey) ?? '')).toEqual({ volume: 0.7, muted: false })
  })

  test('leaving ends the session with its last position, once, then lets the catalogue know', async () => {
    const w = world()
    await w.started()
    await w.play(5000)
    w.server.log.splice(0)
    w.controller.stop()
    await w.settle()
    expect(w.server.log).toEqual(['heartbeat s1 5000', 'end s1'])
    expect(w.calls.letGo).toBe(1)
    expect(w.fake.current()).toBeUndefined()
  })

  test('a remount (stop, start) keeps the session', async () => {
    const w = world()
    await w.started()
    w.controller.stop()
    w.controller.start()
    await w.settle()
    expect(w.server.log.filter((line) => line.startsWith('end'))).toEqual([])
    expect(w.server.created).toHaveLength(1)
    expect(w.fake.commands.filter((line) => line.startsWith('load'))).toEqual([
      'load s1 at 0',
      'load s1 at 0',
    ])
  })

  test('leaving while the session is being created ends it as soon as it exists', async () => {
    const w = world()
    w.server.hold()
    w.controller.start()
    await w.settle()
    w.controller.stop()
    w.server.release()
    await w.settle()
    expect(w.server.log).toEqual(['create', 'heartbeat s1 0 paused', 'end s1'])
    expect(w.fake.loads).toHaveLength(0)
  })

  test('closing the page sends the position by beacon', async () => {
    const w = world()
    await w.started()
    await w.play(3000)
    for (const listener of [...w.hide]) listener()
    expect(w.server.log.at(-1)).toBe('beacon s1 3000')
  })

  test('a lost network reconnects after 1 s with a new session at the position, paused if it was', async () => {
    const w = world()
    await w.started()
    await w.play(4000)
    w.fake.current()?.fail({ message: 'network down', network: true })
    w.fake.emit('waiting', { paused: true })
    expect(w.controller.view()).toMatchObject({ networkLost: true, blocked: false, loading: true })
    await w.play(999)
    expect(w.server.created).toHaveLength(1)
    await w.play(1)
    expect(creations(w.server.created).at(-1)).toMatchObject({
      startPositionMs: 4000,
      sourceId: 'source-1',
    })
    // It was paused when the network went: the new session stays paused.
    expect(w.fake.current()?.load.autoplay).toBe(false)
    w.fake.loaded(1200)
    expect(w.controller.get().reconnectAttempt).toBe(1)
    w.controller.togglePlay()
    expect(w.controller.get()).toMatchObject({ reconnectAttempt: 0, interruption: undefined })
  })

  test('a stream failure blocks; "Retry" starts again where it was', async () => {
    const w = world()
    await w.started()
    await w.play(2000)
    w.fake.current()?.fail({ message: 'decode', network: false })
    expect(w.controller.view()).toMatchObject({
      blocked: true,
      failure: playerFailure(0, 'playback/stream_failed', 'decode'),
    })
    w.controller.restart()
    await w.settle()
    expect(w.server.created.at(-1)?.startPositionMs).toBe(2000)
    expect(w.controller.view().blocked).toBe(false)
  })

  test('stopped by the administrator: blocked, the session is not ended again', async () => {
    const w = world()
    await w.started()
    w.controller.sessionTerminated({ playbackSessionId: 's1', reason: 'admin' })
    expect(w.controller.view().blocked).toBe(true)
    expect(w.controller.get().interruption).toEqual({ kind: 'terminated', reason: 'admin' })
    w.controller.stop()
    await w.settle()
    expect(w.server.log.filter((line) => line.startsWith('end'))).toEqual([])
  })
})

describe('player controller: tracks and quality (§11.3)', () => {
  const tracks = {
    audioTracks: [audio(1, 'en'), audio(2, 'fr')],
    subtitleTracks: [subtitle('sub-fr', 'fr'), subtitle('sub-pgs', 'en', 'burn_in')],
  }

  test('an audio change starts a new session at the position (browser engine)', async () => {
    const w = world({ session: tracks })
    await w.started()
    await w.play(8000)
    w.controller.chooseAudio(audio(2, 'fr'))
    expect(w.calls.switched).toBe(1)
    expect(w.controller.get().switching).toEqual({ positionMs: 8000, totalMs: 1_200_000 })
    await w.settle()
    expect(w.server.log).toContain('end s1')
    expect(creations(w.server.created).at(-1)).toEqual({
      itemId: 'item-1',
      quality: 'original',
      startPositionMs: 8000,
      sourceId: 'source-1',
      audioStreamIndex: 2,
    })
    expect(w.fake.commands).toContain('unload s1')
    expect(w.fake.current()?.load.session.id).toBe('s2')
    // The audio of the cascade is remembered once the new session tells what it chose.
    expect(w.server.log).toContain('put item-1 {"audioLanguage":"fr","subtitlesEnabled":false}')
    expect(w.controller.get().toast).toMatchObject({ kind: 'audio', status: 'applied' })
  })

  test('an engine that switches audio in place keeps the session and only reports the change', async () => {
    const w = world({ session: tracks, capabilities: { switchesAudioInPlace: true } })
    await w.started()
    w.controller.chooseAudio(audio(2, 'fr'))
    await w.settle()
    expect(w.server.created).toHaveLength(1)
    expect(w.fake.commands).toContain('audio 2')
    expect(w.controller.view().audioIndex).toBe(2)
    expect(w.server.log).toContain('put item-1 {"audioLanguage":"fr","subtitlesEnabled":false}')
    expect(w.server.log.at(-2)).toBe('heartbeat s1 0')
  })

  test('a WebVTT subtitle changes in place; a burnt-in one needs a new session', async () => {
    const w = world({ session: tracks })
    await w.started()
    w.controller.chooseSubtitle({ kind: 'track', track: subtitle('sub-fr', 'fr') })
    await w.settle()
    expect(w.server.created).toHaveLength(1)
    expect(w.controller.view().subtitleId).toBe('sub-fr')
    expect(w.fake.commands).toContain('subtitle sub-fr')
    expect(w.server.log).toContain('put item-1 {"subtitleLanguage":"fr","subtitlesEnabled":true}')

    w.controller.chooseSubtitle({ kind: 'track', track: subtitle('sub-pgs', 'en', 'burn_in') })
    await w.settle()
    expect(creations(w.server.created).at(-1)).toMatchObject({ subtitleTrackId: 'sub-pgs' })
  })

  test('"Undo" restores the memory the item had', async () => {
    const w = world({ session: tracks })
    await w.started()
    w.controller.chooseSubtitle({ kind: 'track', track: subtitle('sub-fr', 'fr') })
    await w.settle()
    w.controller.undoMemory()
    await w.settle()
    expect(w.server.log.at(-1)).toBe('delete item-1')
    expect(w.controller.get().toast?.status).toBe('undone')
    await w.play(2500)
    expect(w.controller.get().toast).toBeUndefined()
  })

  test('"Set as default" updates the profile', async () => {
    const w = world({ session: tracks })
    await w.started()
    w.controller.chooseSubtitle({ kind: 'track', track: subtitle('sub-fr', 'fr') })
    w.controller.setProfileDefault()
    await w.settle()
    expect(w.server.log).toContain('profile profile-1 {"subtitleLanguage":"fr"}')
    expect(w.controller.get().toast?.status).toBe('defaulted')
  })

  test('a quality change transcodes from the same position, the old session ends', async () => {
    const w = world()
    await w.started()
    await w.play(6000)
    w.controller.chooseQuality('720p')
    await w.settle()
    expect(w.server.log).toContain('end s1')
    expect(creations(w.server.created).at(-1)).toMatchObject({
      quality: '720p',
      startPositionMs: 6000,
    })
  })
})

describe('player controller: segments and next episode (§12.4)', () => {
  const intro = { type: 'intro' as const, startMs: 2000, endMs: 30_000 }
  const credits = { type: 'credits' as const, startMs: 1_100_000, endMs: 1_200_000 }

  test('auto skip intro: once, to the end of the intro; "Undo" goes back and stays', async () => {
    const w = world({
      session: { segments: [intro] },
      context: { profile: { ...profile, autoSkipIntro: true } },
    })
    await w.started()
    await w.play(2250)
    expect(w.fake.commands).toContain('seek 30')
    expect(w.controller.get().skipped?.segment).toEqual(intro)
    w.controller.undoSkip()
    expect(w.fake.media().currentTime).toBe(2)
    await w.play(1000)
    expect(w.fake.commands.filter((line) => line === 'seek 30')).toHaveLength(1)
  })

  test('without auto skip, the button skips and the toast hides after 8 s', async () => {
    const w = world({ session: { segments: [intro] } })
    await w.started()
    await w.play(3000)
    expect(w.controller.view().skippable).toEqual(intro)
    expect(w.fake.commands).not.toContain('seek 30')
    w.controller.skipSegment()
    expect(w.fake.media().currentTime).toBe(30)
    await w.play(8000)
    expect(w.controller.get().skipped).toBeUndefined()
  })

  test('the credits start a 10 s countdown while playing, held by a pause, then the next episode', async () => {
    const w = world({
      session: { segments: [credits], startPositionMs: 1_099_000 },
      context: { next: 'found' },
    })
    await w.started()
    await w.play(1000)
    expect(w.controller.view().nextUpView).toBe('bubble')
    await w.play(5000)
    w.controller.togglePlay()
    await w.play(20_000)
    expect(w.calls.playNext).toBe(0)
    w.controller.togglePlay()
    await w.play(5250)
    expect(w.calls.playNext).toBe(1)
  })

  test('"Watch the credits" cancels the countdown for the episode', async () => {
    const w = world({
      session: { segments: [credits], startPositionMs: 1_100_000 },
      context: { next: 'found' },
    })
    await w.started()
    w.controller.watchCredits()
    await w.play(15_000)
    expect(w.controller.view().nextUpView).toBe('none')
    expect(w.calls.playNext).toBe(0)
  })

  test('the end of an item without a next one returns after 5 s', async () => {
    const w = world({ session: { startPositionMs: 1_195_000 } })
    await w.started()
    await w.play(5000)
    expect(w.controller.view().itemEnded).toBe(true)
    await w.play(4500)
    expect(w.calls.exit).toBe(0)
    await w.play(500)
    expect(w.calls.exit).toBe(1)
  })
})

describe('player controller: parts', () => {
  const parts = [
    { sourceId: 'part-1', index: 1, offsetMs: 0, durationMs: 60_000 },
    { sourceId: 'part-2', index: 2, offsetMs: 60_000, durationMs: 60_000 },
  ]
  const answer = (body: CreatePlaybackSessionBody, index: number) =>
    sessionDto(`s${index + 1}`, {
      sourceId: body.sourceId ?? 'part-1',
      startPositionMs: body.startPositionMs ?? 0,
      parts,
      partOffsetMs: body.sourceId === 'part-2' ? 60_000 : 0,
    })

  test('the end of a part chains the next one without a click, the total covers both', async () => {
    const w = world({ answer })
    await w.started(60)
    expect(w.controller.view().totalMs).toBe(120_000)
    await w.play(60_000)
    expect(w.controller.view().itemEnded).toBe(false)
    await w.settle()
    expect(creations(w.server.created).at(-1)).toEqual({
      itemId: 'item-1',
      quality: 'original',
      startPositionMs: 60_000,
      sourceId: 'part-2',
    })
    expect(w.fake.current()?.load).toMatchObject({ startSeconds: 0, autoplay: true })
    expect(w.calls.exit).toBe(0)
  })

  test('a seek into the other part opens it at that position', async () => {
    const w = world({ answer })
    await w.started(60)
    w.controller.seekToItem(90_000)
    await w.settle()
    expect(creations(w.server.created).at(-1)).toMatchObject({
      startPositionMs: 90_000,
      sourceId: 'part-2',
    })
    expect(w.fake.current()?.load.startSeconds).toBe(30)
  })
})
