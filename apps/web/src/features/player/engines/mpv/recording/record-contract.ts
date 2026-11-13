/**
 * Runs the steps of the engine contract (`@projo/player/testing/engine-contract`)
 * against the real libmpv of the desktop app and records what went through
 * the bridge (§28.8). Bundled for the browser and evaluated in the app's
 * window by `e2e/scripts/record-mpv-sequences.ts`, on an origin the app
 * granted its IPC to; never part of the web app.
 *
 * One scenario per contract test, in the contract's order: the replay in
 * `mpv-engine.test.ts` hands them out in that order.
 */
import type { EngineLoad } from '@projo/player/core/engine'
import type { MediaSnapshot, MediaState } from '@projo/player/core/media-state'
import { contractDurationS, contractLoad } from '@projo/player/testing/contract-session'

import type { WebPlayerEngine } from '../../../web-engine.ts'
import { createMpvEngine } from '../mpv-engine.ts'
import { type MpvRecording, recordingBridge, type RecordedEntry } from '../recorded.ts'
import { tauriInternals } from '../../../../../shared/desktop/tauri.ts'
import { createTauriBridge } from '../tauri-bridge.ts'

// Where the recording driver serves the media (any path) and its gate.
export const recordingMediaBase = 'http://127.0.0.1:4891/'

type Gate = 'open' | 'trickle' | 'closed'

type Subject = {
  engine: WebPlayerEngine
  mark: (name: string) => void
  loaded: (load?: Partial<EngineLoad>) => Promise<() => void>
  // The step's effect is there (`check`): the driver's `settle`.
  settle: (check: (state: MediaState, media: MediaSnapshot) => boolean) => Promise<void>
  until: (check: (state: MediaState) => boolean, timeoutMs?: number) => Promise<void>
  gate: (mode: Gate) => Promise<void>
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// A step ends as soon as its effect shows: libmpv keeps playing meanwhile,
// and the contract allows half a second of difference.

export const recordContract = async (): Promise<MpvRecording> => {
  const internals = tauriInternals()
  if (internals === undefined) throw new Error('not in the desktop app')
  const tauri = createTauriBridge(internals)
  const desktop = await tauri.info()
  let entries: RecordedEntry[] = []
  const bridge = recordingBridge(tauri, (entry) => entries.push(entry))
  const scenarios: MpvRecording['scenarios'] = []

  const gate = async (mode: Gate) => {
    await fetch(`${recordingMediaBase}gate?mode=${mode}`)
  }

  const scenario = async (name: string, body: (subject: Subject) => Promise<void>) => {
    entries = []
    const engine = createMpvEngine({
      bridge,
      media: document.createElement('div'),
      baseUrl: () => recordingMediaBase,
      viewport: () => ({ width: 1280, height: 720 }),
      screenHeight: () => undefined,
      // Never a sound from a recording.
      initOptions: { ao: 'null' },
    })
    const until = async (check: (state: MediaState) => boolean, timeoutMs = 20_000) => {
      const end = Date.now() + timeoutMs
      while (!check(engine.state.get())) {
        if (Date.now() > end)
          throw new Error(`${name}: timed out at ${JSON.stringify(engine.state.get())}`)
        await sleep(50)
      }
    }
    const settle = async (check: (state: MediaState, media: MediaSnapshot) => boolean) => {
      await until((state) => check(state, engine.read()))
      entries.push({ mark: 'settled' })
    }
    const subject: Subject = {
      engine,
      mark: (mark) => entries.push({ mark }),
      loaded: async (load = {}) => {
        const unload = engine.load(contractLoad(load), () => {})
        await until(
          (state) =>
            state.ready &&
            !state.waiting &&
            !state.seeking &&
            state.duration > 0 &&
            state.paused === (load.autoplay === false),
        )
        entries.push({ mark: 'loaded' })
        // The contract settles after every load.
        await settle(() => true)
        return unload
      },
      settle,
      until,
      gate,
    }
    await gate('open')
    await body(subject)
    scenarios.push({ name, entries })
    entries = []
    engine.release()
    // The instance is destroyed before the next scenario creates its own.
    await sleep(1500)
  }

  await scenario('load', async ({ loaded }) => void (await loaded()))
  await scenario('load at 20 s', async ({ loaded }) => void (await loaded({ startSeconds: 20 })))
  await scenario('load paused', async ({ loaded }) => void (await loaded({ autoplay: false })))
  await scenario('pause then play', async ({ engine, loaded, settle }) => {
    await loaded()
    engine.pause()
    await settle((state) => state.paused)
    engine.play()
    await settle((state) => !state.paused && !state.waiting)
  })
  await scenario('seek', async ({ engine, loaded, settle }) => {
    await loaded()
    const landed = (target: number) => (state: MediaState, media: MediaSnapshot) =>
      !state.seeking && !state.waiting && Math.abs(media.currentTime - target) < 0.3
    engine.seek(30)
    await settle(landed(30))
    engine.seek(600)
    await settle((state) => state.ended)
    engine.seek(-5)
    await settle(landed(0))
  })
  await scenario('buffering', async ({ loaded, until, gate, mark }) => {
    // A trickle keeps libmpv's cache a few seconds ahead; closing the gate drains it.
    await gate('trickle')
    await loaded()
    await sleep(4000)
    await gate('closed')
    await until((state) => state.waiting, 30_000)
    mark('stalled')
    await gate('trickle')
    await until((state) => !state.waiting, 30_000)
    mark('resumed')
  })
  await scenario('end', async ({ loaded, until, mark }) => {
    await loaded()
    // The contract's `advance(5)` from the start of the stream.
    await until((state) => state.currentTime >= 5)
    mark('advanced')
    await until((state) => state.ended, (contractDurationS + 30) * 1000)
    mark('advanced')
  })
  await scenario('volume and rate', async ({ engine, loaded, settle }) => {
    await loaded()
    engine.setVolume(0.5, false)
    engine.setRate(1.5)
    await settle((state) => state.volume === 0.5 && state.playbackRate === 1.5)
    engine.setVolume(0.5, true)
    await settle((state) => state.muted)
  })
  await scenario('unload', async ({ loaded, settle }) => {
    const unload = await loaded()
    unload()
    await settle((state) => !state.ready)
  })

  return { desktop, media: recordingMediaBase, scenarios }
}

declare global {
  interface Window {
    projoRecordContract?: () => Promise<MpvRecording>
  }
}

window.projoRecordContract = recordContract
