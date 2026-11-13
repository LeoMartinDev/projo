import { bridgeErrorMessage, type DesktopInfo, type MpvBridge, type MpvMessage } from './bridge.ts'

/**
 * libmpv sequences recorded from the desktop app (`recording/`), replayed by
 * the engine's tests (`replay-bridge.ts`): what the engine sent, what each
 * call answered and every message libmpv emitted, in the order they came,
 * with the driver's steps marked.
 */

export type BridgeMethod = keyof MpvBridge

export type RecordedEntry =
  | { send: BridgeMethod; args: unknown[] }
  // A call that answered a value (`getProperty`, `info`), or nothing.
  | { reply: unknown }
  | { done: true }
  | { reject: string }
  | { receive: MpvMessage }
  // The end of a driver step (`loaded`, `settled`, `advanced`…).
  | { mark: string }

export type RecordedScenario = { name: string; entries: RecordedEntry[] }

export type MpvRecording = {
  // How it was recorded (the app and libmpv versions, the media).
  desktop: DesktopInfo
  media: string
  scenarios: RecordedScenario[]
}

/** Wraps a bridge so every call, answer and message lands in `log`. */
export const recordingBridge = (
  bridge: MpvBridge,
  log: (entry: RecordedEntry) => void,
): MpvBridge => {
  const call = <T>(send: BridgeMethod, args: unknown[], run: () => Promise<T>): Promise<T> => {
    log({ send, args })
    return run().then(
      (value) => {
        // `listen` answers a function: nothing to record.
        log(value === undefined || typeof value === 'function' ? { done: true } : { reply: value })
        return value
      },
      (error: unknown) => {
        log({ reject: bridgeErrorMessage(error) })
        throw error
      },
    )
  }
  return {
    init: (options) => call('init', [options], () => bridge.init(options)),
    command: (args) => call('command', [args], () => bridge.command(args)),
    setProperty: (name, value) =>
      call('setProperty', [name, value], () => bridge.setProperty(name, value)),
    getProperty: (name) => call('getProperty', [name], () => bridge.getProperty(name)),
    observe: (names) => call('observe', [names], () => bridge.observe(names)),
    destroy: () => call('destroy', [], () => bridge.destroy()),
    info: () => call('info', [], () => bridge.info()),
    listen: (onMessage) =>
      call('listen', [], () =>
        bridge.listen((message) => {
          log({ receive: message })
          onMessage(message)
        }),
      ),
    setFullscreen: (fullscreen) =>
      call('setFullscreen', [fullscreen], () => bridge.setFullscreen(fullscreen)),
    isFullscreen: () => call('isFullscreen', [], () => bridge.isFullscreen()),
  }
}
