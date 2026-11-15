import { describe, expect, test } from 'bun:test'

import { initialMediaState, type MediaEventType } from '@projo/player/core/media-state'

import type { MpvMessage } from './bridge.ts'
import { idlePlayback, loadingPlayback, type MpvPlayback, stepMpv } from './mpv-events.ts'

const { waiting: _waiting, ...initialMedia } = initialMediaState

const property = (name: string, value?: unknown): MpvMessage =>
  value === undefined ? { kind: 'property', name } : { kind: 'property', name, value }
const event = (name: Extract<MpvMessage, { kind: 'event' }>['event']): MpvMessage => ({
  kind: 'event',
  event: name,
})

const play = (playback: MpvPlayback, messages: MpvMessage[]) => {
  const events: MediaEventType[] = []
  const failures: string[] = []
  let fileLoaded = 0
  let current = playback
  for (const message of messages) {
    const step = stepMpv(current, message)
    current = step.playback
    events.push(...step.events)
    if (step.failure !== undefined) failures.push(step.failure)
    if (step.fileLoaded === true) fileLoaded += 1
  }
  return { playback: current, events, failures, fileLoaded }
}

// What libmpv sends after `loadfile` with `start` (recorded, fixtures/).
const loadMessages = (start: number): MpvMessage[] => [
  event('file-loaded'),
  event('seek'),
  property('time-pos', start),
  property('duration', 60),
  property('paused-for-cache', false),
  property('eof-reached', false),
  property('demuxer-cache-time', 59.9),
]

const playing = (start = 0) =>
  play(loadingPlayback(initialMedia, start), [
    ...loadMessages(start),
    property('pause', false),
    event('playback-restart'),
  ]).playback

describe('stepMpv', () => {
  test('a load: metadata on file-loaded, playing once libmpv restarts unpaused', () => {
    const { events, playback, fileLoaded } = play(loadingPlayback(initialMedia, 0), [
      ...loadMessages(0),
      property('pause', false),
      event('playback-restart'),
    ])
    expect(fileLoaded).toBe(1)
    expect(events).toEqual([
      'loadedmetadata',
      'seeking',
      'timeupdate',
      'durationchange',
      'progress',
      'play',
      'timeupdate',
      'seeked',
      'canplay',
      'playing',
    ])
    expect(playback.media).toMatchObject({ ready: true, paused: false, duration: 60 })
  })

  test('a start position is a seek until the first restart', () => {
    const { events, playback } = play(loadingPlayback(initialMedia, 20), loadMessages(20))
    expect(events.slice(0, 2)).toEqual(['loadedmetadata', 'seeking'])
    expect(playback.media).toMatchObject({ seeking: true, currentTime: 20 })
    const restarted = play(playback, [event('playback-restart')])
    expect(restarted.events).toEqual(['timeupdate', 'seeked', 'canplay'])
    expect(restarted.playback.media.seeking).toBe(false)
  })

  test('the previous file and the idle instance say nothing', () => {
    const loading = loadingPlayback(initialMedia, 12)
    expect(
      play(loading, [
        property('time-pos', 345),
        property('eof-reached', true),
        event('playback-restart'),
        { kind: 'event', event: 'end-file', reason: 'stop' },
      ]),
    ).toMatchObject({ events: [], playback: { media: { currentTime: 12, ended: false } } })
    expect(
      play(idlePlayback(initialMedia), [
        property('pause', false),
        { kind: 'event', event: 'end-file', reason: 'error', error: 'x' },
        event('shutdown'),
      ]),
    ).toMatchObject({ events: [], failures: [] })
  })

  test('time updates at most every quarter second, always while seeking', () => {
    const { events, playback } = play(playing(), [
      property('time-pos', 0.1),
      property('time-pos', 0.2),
      property('time-pos', 0.3),
      property('time-pos', 0.4),
      property('time-pos', 0.6),
    ])
    expect(events).toEqual(['timeupdate', 'timeupdate'])
    expect(playback.media.currentTime).toBe(0.6)
    expect(
      play(playback, [event('seek'), property('time-pos', 30), event('playback-restart')]).events,
    ).toEqual(['seeking', 'timeupdate', 'timeupdate', 'seeked', 'playing'])
  })

  test('pause, play, buffering', () => {
    const paused = play(playing(), [property('pause', true)])
    expect(paused.events).toEqual(['pause'])
    expect(play(paused.playback, [property('pause', false)]).events).toEqual(['play', 'playing'])
    const stalled = play(playing(), [property('paused-for-cache', true)])
    expect(stalled.events).toEqual(['waiting'])
    expect(play(stalled.playback, [property('paused-for-cache', false)]).events).toEqual([
      'playing',
    ])
    // Paused while buffering: it can play again, it does not.
    expect(
      play(stalled.playback, [property('pause', true), property('paused-for-cache', false)]).events,
    ).toEqual(['pause', 'canplay'])
  })

  test('the end (keep-open): pause then ended, whatever the order, then silence', () => {
    const eofFirst = play(playing(), [
      property('eof-reached', true),
      property('pause', true),
      property('time-pos', 59.99),
      property('demuxer-cache-time', 60),
    ])
    expect(eofFirst.events).toEqual(['pause', 'ended'])
    expect(eofFirst.playback.media).toMatchObject({ ended: true, paused: true })
    const pauseFirst = play(playing(), [property('pause', true), property('eof-reached', true)])
    expect(pauseFirst.events).toEqual(['pause', 'ended'])
    // A seek back leaves the end.
    expect(
      play(eofFirst.playback, [event('seek'), property('eof-reached', false)]).playback.media.ended,
    ).toBe(false)
  })

  test('volume, mute and speed in libmpv units', () => {
    const { events, playback } = play(playing(), [
      property('volume', 50),
      property('mute', true),
      property('speed', 1.5),
      property('volume', 130),
    ])
    expect(events).toEqual(['volumechange', 'volumechange', 'ratechange', 'volumechange'])
    expect(playback.media).toMatchObject({ volume: 1, muted: true, playbackRate: 1.5 })
  })

  test('errors: a failed file, libmpv shutting down', () => {
    expect(
      play(loadingPlayback(initialMedia, 0), [
        { kind: 'event', event: 'end-file', reason: 'error', error: 'loading failed' },
      ]).failures,
    ).toEqual(['loading failed'])
    expect(play(playing(), [event('shutdown')]).failures).toEqual(['libmpv stopped'])
    // Without keep-open (or an HLS end), `end-file` with `eof` ends it.
    expect(play(playing(), [{ kind: 'event', event: 'end-file', reason: 'eof' }]).events).toEqual([
      'pause',
      'ended',
    ])
  })
})
