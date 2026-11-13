import type { ServerNameStore } from '../../../core/settings/settings.ts'

export type ServerSettingsView = {
  name: string
  port: number
  trustProxy: boolean
  dataDir: string
}

/** The stored server name, with what the environment sets. */
export const serverSettingsView = (
  store: Pick<ServerNameStore, 'read'>,
  environment: Omit<ServerSettingsView, 'name'>,
): ServerSettingsView => ({ name: store.read(), ...environment })
