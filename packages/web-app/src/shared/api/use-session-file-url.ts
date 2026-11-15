import { useEffect, useState } from 'react'

import { useHost } from '../../host.ts'
import { profileHeaders, serverFetch } from './client.ts'

/**
 * A URL an element can load (`<track src>`) for a server path that needs the session: the path
 * itself when the page is the server's (its cookie goes with it); else a blob of what the host's
 * fetch answers (the desktop app's bearer, which an element cannot send). Undefined until ready.
 */
export const useSessionFileUrl = (path: string | undefined): string | undefined => {
  const { serverOrigin } = useHost()
  const direct = serverOrigin === ''
  const [blob, setBlob] = useState<{ path: string; url: string }>()

  useEffect(() => {
    if (direct || path === undefined) return
    let active = true
    let url: string | undefined
    void serverFetch(path, { headers: profileHeaders() })
      .then((response) => (response.ok ? response.blob() : undefined))
      .then((body) => {
        if (!active || body === undefined) return
        url = URL.createObjectURL(body)
        setBlob({ path, url })
      })
      .catch(() => undefined)
    return () => {
      active = false
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [direct, path])

  if (path === undefined) return undefined
  if (direct) return path
  return blob?.path === path ? blob.url : undefined
}
