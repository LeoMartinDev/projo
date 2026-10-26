import { err, ok, type Result } from '@projo/shared/result'

import { type ConnectionError, connectionError } from './connection-error.ts'

const schemePattern = /^([a-z][a-z\d+.-]*):\/\//i
const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/
/** `scheme://host[:port][/path][?query][#fragment]`; the host is a name, IPv4 or `[IPv6]`. */
const urlPattern =
  /^(https?):\/\/(\[[\da-f:.]+\]|[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*)(?::(\d{1,5}))?(\/[^?#\s]*)?(?:\?[^#\s]*)?(?:#\S*)?$/i
const defaultPorts: Record<string, string> = { http: '80', https: '443' }

/**
 * Scheme guessed when none is typed: plain HTTP for what looks like a home network (localhost, an
 * IP address, a `.local` name, an explicit port), HTTPS for a domain name (a reverse proxy, §26.3).
 */
const guessScheme = (authority: string): 'http' | 'https' => {
  const host = authority
    .toLowerCase()
    .replace(/^\[([^\]]*)\].*$/, '$1')
    .replace(/:\d+$/, '')
  const local =
    host === 'localhost' ||
    ipv4Pattern.test(host) ||
    host.includes(':') ||
    host.endsWith('.local') ||
    /:\d+$/.test(authority)
  return local ? 'http' : 'https'
}

/**
 * The server URL as typed → its canonical form: `http(s)://host[:port][/path]`, lower-case host,
 * no default port, no trailing slash, no query nor fragment. The API lives at `<url>/api/v1`, the
 * health check at `<url>/health`. Parsed by hand: React Native's `URL` is not the WHATWG one.
 */
export const normalizeServerUrl = (
  input: string,
): Result<string, ConnectionError<'connection/invalid_url'>> => {
  const trimmed = input.trim()
  const withScheme = schemePattern.test(trimmed)
    ? trimmed
    : `${guessScheme(trimmed.split(/[/?#]/)[0] ?? '')}://${trimmed}`
  const match = urlPattern.exec(withScheme)
  const port = match?.[3]
  if (!match || (port !== undefined && Number(port) > 65_535))
    return err(
      connectionError('connection/invalid_url', 'invalid server URL', { context: { input } }),
    )
  const scheme = (match[1] ?? '').toLowerCase()
  const host = (match[2] ?? '').toLowerCase()
  const path = (match[4] ?? '').replace(/\/+$/, '')
  const explicitPort =
    port === undefined || String(Number(port)) === defaultPorts[scheme] ? '' : `:${Number(port)}`
  return ok(`${scheme}://${host}${explicitPort}${path}`)
}
