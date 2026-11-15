import type { AboutRow } from '../host.ts'
import { stringField, type TauriInternals } from './tauri.ts'

/** Account → About: the desktop app's version (`desktop_info`, §28.6). */
export const desktopAboutRows =
  (internals: TauriInternals) => async (): Promise<readonly AboutRow[]> => {
    const version = stringField(
      await internals.invoke('desktop_info').catch(() => undefined),
      'version',
    )
    return version === undefined ? [] : [{ label: 'desktopApp', value: version }]
  }
