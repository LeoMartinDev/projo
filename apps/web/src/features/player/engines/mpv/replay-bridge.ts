import type { MpvBridge, MpvMessage } from './bridge.ts'
import type { BridgeMethod, RecordedEntry, RecordedScenario } from './recorded.ts'

/**
 * libmpv as it was recorded (`recorded.ts`), for the engine's tests: every
 * call the engine makes must be the recorded one, in the recorded order; it
 * answers what libmpv answered, and libmpv's messages come back between them
 * as they did. `through(mark)` plays the recording to the end of a driver
 * step.
 */
export type ReplayBridge = {
  bridge: MpvBridge
  through: (mark: string) => Promise<void>
}

type Call = {
  method: BridgeMethod
  args: unknown[]
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  // `listen`: where the messages go once it answered.
  onMessage?: (message: MpvMessage) => void
}

const describe = (entry: RecordedEntry | undefined) =>
  entry === undefined ? 'the end of the recording' : JSON.stringify(entry)

// Rounds of the event loop the replay waits for a call before giving up.
const patience = 200

export const replayBridge = (scenario: RecordedScenario): ReplayBridge => {
  const { entries } = scenario
  let cursor = 0
  const calls: Call[] = []
  let answering: Call | undefined
  let onMessage: ((message: MpvMessage) => void) | undefined

  const call = (method: BridgeMethod, args: unknown[], extra: Partial<Call> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      calls.push({ method, args, resolve, reject, ...extra })
    })

  const failure = (message: string) =>
    new Error(`replay of "${scenario.name}", entry ${cursor}: ${message}`)

  // One entry; false when the replay waits for the engine (or a mark).
  const step = (): boolean => {
    const entry = entries[cursor]
    if (entry === undefined || 'mark' in entry) return false
    if ('receive' in entry) {
      cursor += 1
      onMessage?.(entry.receive)
      return true
    }
    if ('send' in entry) {
      const next = calls[0]
      if (next === undefined) return false
      if (next.method !== entry.send || JSON.stringify(next.args) !== JSON.stringify(entry.args))
        throw failure(
          `the engine called ${next.method} ${JSON.stringify(next.args)}, the recording ${entry.send} ${JSON.stringify(entry.args)}`,
        )
      calls.shift()
      answering = next
      cursor += 1
      return true
    }
    const answered = answering
    if (answered === undefined) throw failure('an answer without a call')
    answering = undefined
    cursor += 1
    if ('reject' in entry) {
      answered.reject(entry.reject)
      return true
    }
    if (answered.onMessage !== undefined) {
      onMessage = answered.onMessage
      answered.resolve(() => {
        onMessage = undefined
      })
      return true
    }
    answered.resolve('reply' in entry ? entry.reply : undefined)
    return true
  }

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  const through = async (mark: string) => {
    let waited = 0
    for (;;) {
      if (step()) {
        waited = 0
        await Promise.resolve()
        continue
      }
      const entry = entries[cursor]
      if (entry !== undefined && 'mark' in entry) {
        if (entry.mark !== mark)
          throw failure(`at mark "${entry.mark}", the driver asked "${mark}"`)
        cursor += 1
        await tick()
        return
      }
      waited += 1
      if (waited > patience)
        throw failure(
          `waiting for ${describe(entry)}; the engine called ${JSON.stringify(calls.map(({ method, args }) => [method, args]))}`,
        )
      await tick()
    }
  }

  const bridge: MpvBridge = {
    init: async (options) => void (await call('init', [options])),
    command: async (args) => void (await call('command', [args])),
    setProperty: async (name, value) => void (await call('setProperty', [name, value])),
    getProperty: (name) => call('getProperty', [name]),
    observe: async (names) => void (await call('observe', [names])),
    destroy: async () => void (await call('destroy', [])),
    info: async () => (await call('info', [])) as { version: string; mpv: string },
    listen: async (listener) => (await call('listen', [], { onMessage: listener })) as () => void,
    setFullscreen: async (fullscreen) => void (await call('setFullscreen', [fullscreen])),
    isFullscreen: async () => (await call('isFullscreen', [])) === true,
  }

  return { bridge, through }
}
