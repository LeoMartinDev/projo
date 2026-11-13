import type { Clock } from '../../core/clock.ts'
import type { ServerNameStore } from '../../core/settings/settings.ts'
import { type ServerSettingsView, serverSettingsView } from './shared/server-settings-view.ts'

type Deps = {
  store: ServerNameStore
  environment: Omit<ServerSettingsView, 'name'>
  clock: Clock
}

export const updateServerSettingsFactory =
  ({ store, environment, clock }: Deps) =>
  ({ name }: { name?: string }): ServerSettingsView => {
    if (name !== undefined) store.write({ name, at: clock.now() })
    return serverSettingsView(store, environment)
  }

export type UpdateServerSettings = ReturnType<typeof updateServerSettingsFactory>
