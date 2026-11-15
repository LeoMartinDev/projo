import { fromPromise, map, type Result } from '@projo/shared/result'
import { stringField, type TauriInternals } from '@projo/web-app/desktop/tauri.ts'

/** A command the desktop app refused: its `{ code, message }` (commands.rs `CommandError`). */
export type CommandFailure = { readonly code: string; readonly message: string }

export const commandFailure = (cause: unknown): CommandFailure => ({
  code: stringField(cause, 'code') ?? 'unknown',
  message:
    stringField(cause, 'message') ??
    (cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown'),
})

export type ServerCheck = { readonly serverUrl: string; readonly version: string }

/**
 * The desktop app's commands the host uses (§28.6, since 0.5.0): the saved server, its check from
 * Rust (no CORS: a server too old for the bundled UI still tells its version), the session token
 * in the Windows Credential Manager, and the device name.
 */
export type DesktopCommands = {
  getServer: () => Promise<Result<string | undefined, CommandFailure>>
  checkServer: (url: string) => Promise<Result<ServerCheck, CommandFailure>>
  saveServer: (url: string) => Promise<Result<string, CommandFailure>>
  getToken: () => Promise<Result<string | undefined, CommandFailure>>
  setToken: (token: string) => Promise<Result<void, CommandFailure>>
  clearToken: () => Promise<Result<void, CommandFailure>>
  /** `desktop_device().deviceName` (never libmpv); `Windows` when the app cannot tell (§28.3). */
  deviceName: () => Promise<string>
  /** Forgets the token, stops libmpv, reloads on the server address screen (`change_server`). */
  changeServer: () => Promise<Result<void, CommandFailure>>
}

export const fallbackDeviceName = 'Windows'

export const tauriCommands = (internals: TauriInternals): DesktopCommands => {
  const invoke = (command: string, args?: Record<string, unknown>) =>
    fromPromise(() => internals.invoke(command, args), commandFailure)
  return {
    getServer: async () =>
      map(await invoke('get_server'), (answer) => stringField(answer, 'serverUrl')),
    checkServer: async (url) =>
      map(await invoke('check_server', { url }), (answer) => ({
        serverUrl: stringField(answer, 'serverUrl') ?? url,
        version: stringField(answer, 'version') ?? '',
      })),
    saveServer: async (url) =>
      map(
        await invoke('save_server', { url }),
        (answer) => stringField(answer, 'serverUrl') ?? url,
      ),
    getToken: async () => map(await invoke('get_token'), (answer) => stringField(answer, 'token')),
    setToken: async (token) => map(await invoke('set_token', { token }), () => undefined),
    clearToken: async () => map(await invoke('clear_token'), () => undefined),
    deviceName: async () => {
      const device = await invoke('desktop_device')
      return (device.ok ? stringField(device.value, 'deviceName') : undefined) ?? fallbackDeviceName
    },
    changeServer: async () => map(await invoke('change_server'), () => undefined),
  }
}
