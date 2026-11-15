import { useEffect, useState } from 'react'

import { stringField, tauriInternals } from './tauri.ts'

/** The desktop app's version (`desktop_info`, §28.6); nothing in a browser. */
export const useDesktopVersion = (): string | undefined => {
  const [version, setVersion] = useState<string>()

  useEffect(() => {
    const internals = tauriInternals()
    if (internals === undefined) return
    let active = true
    void internals
      .invoke('desktop_info')
      .then((info) => {
        const found = stringField(info, 'version')
        if (active && found !== undefined) setVersion(found)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return version
}
