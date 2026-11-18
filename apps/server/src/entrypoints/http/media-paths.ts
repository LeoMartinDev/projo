const apiPrefix = '/api/v1'

/**
 * Routes under `/api/v1` serving what a page loads by itself, without a header (§20): artwork,
 * TMDB posters, trickplay sprites, the home preview `<video>`, channel logos (§29.7). They
 * accept the media key (GET and HEAD) and, outside a cookie session, answer
 * `Cross-Origin-Resource-Policy: cross-origin`.
 */
const mediaPath =
  /^\/(?:images|previews|trickplay)\/|^\/admin\/tmdb\/posters\/|^\/tv\/channels\/[^/]+\/logo$/

/** Stream capability URLs (§20): `/stream/:sessionId/:secret/…`. */
const streamPath = /^\/stream\//

/**
 * No dot segment and no percent-encoding: a media path never needs either, and refusing them
 * keeps a path that only looks like a media path (`/images/../auth/me`) from passing as one.
 */
const plainPath = (path: string): boolean => !/%|\/\.\.?(?:\/|$)/.test(path)

const underApi = (path: string): string | undefined =>
  path.startsWith(`${apiPrefix}/`) ? path.slice(apiPrefix.length) : undefined

/** `path` relative to `/api/v1`. */
export const isMediaApiPath = (path: string): boolean => plainPath(path) && mediaPath.test(path)

/** `path` from the root. */
export const isMediaPath = (path: string): boolean => {
  const relative = underApi(path)
  return relative !== undefined && isMediaApiPath(relative)
}

/** `path` from the root. */
export const isStreamPath = (path: string): boolean => {
  const relative = underApi(path)
  return relative !== undefined && streamPath.test(relative)
}
