import { boundHost } from '../host/bound-host.ts'
import { resolveMediaUrl } from './media-url.ts'

// The media key of the session (§20): given by `GET /auth/me` on a bearer session only.
let mediaKey: string | undefined

export const setMediaKey = (key: string | undefined): void => {
  mediaKey = key
}

/** The URL of a server path the page loads by itself (`<img>`, `srcset`, CSS `url()`, `<video>`). */
export const mediaUrl = (path: string): string =>
  resolveMediaUrl({
    serverOrigin: boundHost().serverOrigin,
    ...(mediaKey === undefined ? {} : { mediaKey }),
  })(path)
