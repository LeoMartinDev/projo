import type { AppError, Result } from '@projo/shared'

/**
 * OAuth 2.1 of the MCP server (§27.3): projo is its own authorization server. Public clients only
 * (no secret), PKCE S256, authorization code then rotated refresh tokens. A successful code
 * exchange creates an assistant (`kind = oauth`), the "AI assistants" row the admin revokes.
 */

const minuteMs = 60_000
const dayMs = 24 * 60 * minuteMs

export const oauthLifetimes = {
  codeMs: minuteMs,
  accessTokenMs: 60 * minuteMs,
  refreshTokenMs: 90 * dayMs,
  /** A Client ID Metadata Document is read again after this. */
  clientMetadataMs: dayMs,
  /** A registered client never used for this long is deleted. */
  unusedRegistrationMs: 30 * dayMs,
} as const

/** `review` is the one scope of the tools; `offline_access` asks for a refresh token. */
export const oauthScopes = ['review', 'offline_access'] as const

export type OAuthClient = {
  /** projo's id. */
  id: string
  /** The client's: a CIMD URL, or the id given at registration. */
  clientId: string
  kind: 'cimd' | 'dcr'
  name: string
  redirectUris: string[]
  createdAt: Date
  fetchedAt?: Date
  lastUsedAt?: Date
}

export type OAuthCode = {
  codeHash: string
  /** `OAuthClient.id`. */
  clientId: string
  accountId: string
  profileId: string
  redirectUri: string
  codeChallenge: string
  scope: string
  expiresAt: Date
  usedAt?: Date
}

export type OAuthToken = {
  tokenHash: string
  assistantId: string
  kind: 'access' | 'refresh'
  expiresAt: Date
  rotatedAt?: Date
}

export type OAuthRepository = {
  findClient: (clientId: string) => OAuthClient | undefined
  findClientById: (id: string) => OAuthClient | undefined
  /** Inserts, or replaces the client with the same `clientId` (a CIMD read again). */
  saveClient: (client: OAuthClient) => OAuthClient
  touchClient: (input: { id: string; at: Date }) => void
  createCode: (code: OAuthCode) => void
  /** Marks the code used and returns it; undefined when unknown or already used. */
  consumeCode: (input: { codeHash: string; usedAt: Date }) => OAuthCode | undefined
  createToken: (token: OAuthToken) => void
  findToken: (tokenHash: string) => OAuthToken | undefined
  /** False when it was already rotated (two refreshes racing: only one wins). */
  markRotated: (input: { tokenHash: string; at: Date }) => boolean
  /** Expired codes and tokens, and registrations unused since `unusedBefore`. */
  purge: (input: { now: Date; unusedBefore: Date }) => void
}

/** What a Client ID Metadata Document says (only the fields projo reads). */
export type ClientMetadataDocument = {
  clientId: string
  name?: string
  redirectUris: string[]
}

/**
 * Reads a Client ID Metadata Document: HTTPS only, no redirect, small and fast, never from a
 * loopback, private or link-local address.
 */
export type ClientMetadataFetcher = (
  url: string,
) => Promise<Result<ClientMetadataDocument, AppError<'oauth/invalid_client'>>>

/** PKCE S256: `BASE64URL(SHA256(verifier)) === challenge`, compared in constant time. */
export type PkceVerifier = (input: { verifier: string; challenge: string }) => boolean

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

const parseUrl = (value: string): URL | undefined =>
  URL.canParse(value) ? new URL(value) : undefined

/** A redirect URI projo accepts: HTTPS, or a loopback over HTTP (native clients, RFC 8252). */
export const isAcceptableRedirectUri = (value: string): boolean => {
  const url = parseUrl(value)
  if (url === undefined || url.hash !== '') return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && loopbackHosts.has(url.hostname)
}

export const isLoopbackRedirectUri = (value: string): boolean => {
  const url = parseUrl(value)
  return url !== undefined && url.protocol === 'http:' && loopbackHosts.has(url.hostname)
}

/**
 * The redirect URI of a request against one the client declared: exact, except the port of a
 * loopback (RFC 8252 §7.3, also for `localhost`: Claude Code picks a port per session).
 */
export const redirectUriMatches = (declared: string, given: string): boolean => {
  if (declared === given) return true
  const a = parseUrl(declared)
  const b = parseUrl(given)
  if (a === undefined || b === undefined) return false
  if (!isLoopbackRedirectUri(declared) || !isLoopbackRedirectUri(given)) return false
  return (
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search
  )
}

/** The scopes granted: the known ones asked for, `review` always. */
export const grantedScope = (asked: string | undefined): string => {
  const words = new Set((asked ?? '').split(/\s+/).filter((word) => word !== ''))
  return oauthScopes.filter((scope) => scope === 'review' || words.has(scope)).join(' ')
}

/** `resource` (RFC 8707), when given, must name this MCP server. */
export const resourceMatches = (resource: string | undefined, mcpUrl: string): boolean =>
  resource === undefined || resource.replace(/\/+$/, '') === mcpUrl

/** `redirect_uri` with `code` or `error`, and `state` when the client sent one. */
export const redirectWith = (
  redirectUri: string,
  params: Record<string, string | undefined>,
): string => {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}
