import type { AppError, Result } from '@projo/shared'

const minuteMs = 60_000
const dayMs = 24 * 60 * minuteMs

export const oauthLifetimes = {
  codeMs: minuteMs,
  accessTokenMs: 60 * minuteMs,
  refreshTokenMs: 90 * dayMs,
  clientMetadataMs: dayMs,
  unusedRegistrationMs: 30 * dayMs,
} as const

export const oauthScopes = ['review', 'offline_access'] as const

export type OAuthClient = {
  id: string
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
  /** The scope granted at consent, carried through every rotation. */
  scope: string
  expiresAt: Date
  rotatedAt?: Date
}

export type OAuthRepository = {
  findClient: (clientId: string) => OAuthClient | undefined
  findClientById: (id: string) => OAuthClient | undefined
  saveClient: (client: OAuthClient) => OAuthClient
  touchClient: (input: { id: string; at: Date }) => void
  createCode: (code: OAuthCode) => void
  consumeCode: (input: { codeHash: string; usedAt: Date }) => OAuthCode | undefined
  createToken: (token: OAuthToken) => void
  findToken: (tokenHash: string) => OAuthToken | undefined
  markRotated: (input: { tokenHash: string; at: Date }) => boolean
  purge: (input: { now: Date; unusedBefore: Date }) => void
}

export type ClientMetadataDocument = {
  clientId: string
  name?: string
  redirectUris: string[]
}

export type ClientMetadataFetcher = (
  url: string,
) => Promise<Result<ClientMetadataDocument, AppError<'oauth/invalid_client'>>>

export type PkceVerifier = (input: { verifier: string; challenge: string }) => boolean

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

const parseUrl = (value: string): URL | undefined =>
  URL.canParse(value) ? new URL(value) : undefined

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

export const grantedScope = (asked: string | undefined): string => {
  const words = new Set((asked ?? '').split(/\s+/).filter((word) => word !== ''))
  return oauthScopes.filter((scope) => scope === 'review' || words.has(scope)).join(' ')
}

export const resourceMatches = (resource: string | undefined, mcpUrl: string): boolean =>
  resource === undefined || resource.replace(/\/+$/, '') === mcpUrl

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
