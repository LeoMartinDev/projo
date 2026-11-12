import { type AdminSettingsSections, adminSettingsRoutes } from '../http/routes/admin-settings.ts'
import { defineModule } from './types.ts'

/**
 * `/api/v1/admin/settings` (§15): one page over sections owned by other modules. Each section
 * comes from the module that owns it (metadata, segments, operations for playback and server),
 * so this module builds nothing of its own.
 */
export const buildSettingsModule = (sections: AdminSettingsSections) =>
  defineModule({ exposes: { routes: adminSettingsRoutes(sections) } })

export type SettingsModule = ReturnType<typeof buildSettingsModule>
