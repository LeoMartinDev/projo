import {
  type DesktopInfo,
  type MpvBridge,
  type MpvEndReason,
  mpvEndReasons,
  type MpvEventName,
  mpvEventNames,
  type MpvMessage,
} from './bridge.ts'
import type { TauriInternals, TauriWindow } from '../../../../shared/desktop/tauri.ts'

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && Object(value) === value ? (value as Record<string, unknown>) : {}

// JSON null (IPC has no undefined), without writing the literal (§5.3).
const isNullish = (value: unknown) => value === undefined || (typeof value === 'object' && !value)

const isEventName = (value: unknown): value is MpvEventName =>
  (mpvEventNames as readonly unknown[]).includes(value)
const isEndReason = (value: unknown): value is MpvEndReason =>
  (mpvEndReasons as readonly unknown[]).includes(value)

// The payloads of `mpv://property` and `mpv://event` (§28.6) as messages.
export const propertyMessage = (payload: unknown): MpvMessage | undefined => {
  const { name, value } = record(payload)
  if (typeof name !== 'string') return undefined
  return isNullish(value) ? { kind: 'property', name } : { kind: 'property', name, value }
}

export const eventMessage = (payload: unknown): MpvMessage | undefined => {
  const { event, reason, error } = record(payload)
  if (!isEventName(event)) return undefined
  return {
    kind: 'event',
    event,
    ...(isEndReason(reason) ? { reason } : {}),
    ...(typeof error === 'string' ? { error } : {}),
  }
}

/** The IPC of the desktop app (§28.6) through Tauri's injected internals. */
export const createTauriBridge = (internals: TauriInternals): MpvBridge => {
  const label = internals.metadata?.currentWindow?.label ?? 'main'
  const invoke = (command: string, args?: Record<string, unknown>) =>
    internals.invoke(command, args)

  const listenTo = async (event: string, handle: (payload: unknown) => void) => {
    const handler = internals.transformCallback((message) => handle(record(message)['payload']))
    const id = await invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler })
    return () => {
      if (typeof id !== 'number') return
      ;(window as TauriWindow).__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener?.(event, id)
      void invoke('plugin:event|unlisten', { event, eventId: id }).catch(() => undefined)
    }
  }

  return {
    init: async (options) => void (await invoke('mpv_init', { options })),
    command: async (args) => void (await invoke('mpv_command', { args })),
    setProperty: async (name, value) => void (await invoke('mpv_set_property', { name, value })),
    getProperty: async (name) => {
      const value = await invoke('mpv_get_property', { name })
      return isNullish(value) ? undefined : value
    },
    observe: async (names) => void (await invoke('mpv_observe', { names })),
    destroy: async () => void (await invoke('mpv_destroy')),
    info: async () => {
      const { version, mpv } = record(await invoke('desktop_info'))
      const info: DesktopInfo = {
        version: typeof version === 'string' ? version : '',
        mpv: typeof mpv === 'string' ? mpv : '',
      }
      return info
    },
    listen: async (onMessage) => {
      const forward =
        (toMessage: (payload: unknown) => MpvMessage | undefined) => (payload: unknown) => {
          const message = toMessage(payload)
          if (message !== undefined) onMessage(message)
        }
      const stops = await Promise.all([
        listenTo('mpv://property', forward(propertyMessage)),
        listenTo('mpv://event', forward(eventMessage)),
      ])
      return () => {
        for (const stop of stops) stop()
      }
    },
    setFullscreen: async (fullscreen) =>
      void (await invoke('plugin:window|set_fullscreen', { label, value: fullscreen })),
    isFullscreen: async () => (await invoke('plugin:window|is_fullscreen', { label })) === true,
  }
}
