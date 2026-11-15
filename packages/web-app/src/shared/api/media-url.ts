import { mediaKeyParam } from '@projo/shared/api/auth'

export type MediaUrlContext = {
  /** `''` when the page is served by the server (see `AppHost.serverOrigin`). */
  serverOrigin: string
  /** The session's media key (§20), on a bearer session only. */
  mediaKey?: string
}

const isRootRelative = (url: string): boolean => url.startsWith('/') && !url.startsWith('//')

/** A server path resolved against `serverOrigin`; any other URL as it is. */
export const resolveServerUrl =
  (serverOrigin: string) =>
  (url: string): string =>
    isRootRelative(url) ? `${serverOrigin}${url}` : url

/**
 * The URL a page loads by itself (`<img>`, `srcset`, CSS `url()`, `<video>`) for a server path:
 * resolved against the server's origin, with the media key when the session has one (joined with
 * `&` when the path already has a query). Absolute, `data:` and `blob:` URLs pass unchanged.
 */
export const resolveMediaUrl =
  ({ serverOrigin, mediaKey }: MediaUrlContext) =>
  (url: string): string => {
    if (!isRootRelative(url)) return url
    const resolved = `${serverOrigin}${url}`
    if (mediaKey === undefined) return resolved
    const hashAt = resolved.indexOf('#')
    const base = hashAt === -1 ? resolved : resolved.slice(0, hashAt)
    const hash = hashAt === -1 ? '' : resolved.slice(hashAt)
    const separator = base.includes('?')
      ? base.endsWith('?') || base.endsWith('&')
        ? ''
        : '&'
      : '?'
    return `${base}${separator}${mediaKeyParam}=${encodeURIComponent(mediaKey)}${hash}`
  }
