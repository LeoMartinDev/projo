import type { ServerNameStore } from '../../core/settings/settings.ts'
import { type ServerSettingsView, serverSettingsView } from './shared/server-settings-view.ts'

type Deps = {
  store: Pick<ServerNameStore, 'read'>
  environment: Omit<ServerSettingsView, 'name'>
}

export const getServerSettingsFactory =
  ({ store, environment }: Deps) =>
  (): ServerSettingsView =>
    serverSettingsView(store, environment)

export type GetServerSettings = ReturnType<typeof getServerSettingsFactory>
