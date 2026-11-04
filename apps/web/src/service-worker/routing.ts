import { hasFileExtension, isServerPath } from '@projo/shared/api/web-app'

export const shellPath = '/index.html'
export const skipWaitingMessage = 'skip-waiting'

export type RequestRoute = 'shell' | 'precached' | 'network'

export const routeRequest = ({
  method,
  mode,
  url,
  origin,
  precached,
}: {
  method: string
  mode: string
  url: URL
  origin: string
  precached: ReadonlySet<string>
}): RequestRoute => {
  if (method !== 'GET' || url.origin !== origin || isServerPath(url.pathname)) return 'network'
  if (mode === 'navigate') return hasFileExtension(url.pathname) ? 'network' : 'shell'
  return url.search === '' && precached.has(url.pathname) ? 'precached' : 'network'
}
