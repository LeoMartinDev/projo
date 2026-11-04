/**
 * §27.3 assistants of the MCP server, the "AI assistants" rows: a token created in the admin
 * (`kind = token`, its hash here) or an OAuth connection (`kind = oauth`, its tokens in the OAuth
 * repository, `clientId` its client). Bound to an admin account and to the profile it acts as;
 * valid until revoked.
 */
export type AssistantToken = {
  id: string
  accountId: string
  profileId: string
  kind: 'token' | 'oauth'
  /** `OAuthClient.id`, for `kind = oauth`. */
  clientId?: string
  name: string
  /** For `kind = token`. */
  tokenHash?: string
  createdAt: Date
  lastUsedAt?: Date
  revokedAt?: Date
}

export type AssistantTokenRepository = {
  create: (token: AssistantToken) => AssistantToken
  findById: (id: string) => AssistantToken | undefined
  findByTokenHash: (tokenHash: string) => AssistantToken | undefined
  /** Not revoked, newest first. */
  listActiveByAccount: (accountId: string) => AssistantToken[]
  /**
   * False when the assistant is not live. `accountId`: only one of this account (the admin
   * page); absent: any (a refresh token presented twice revokes its assistant).
   */
  revoke: (input: { id: string; accountId?: string; revokedAt: Date }) => boolean
  touch: (input: { id: string; lastUsedAt: Date }) => void
}

/** `last_used_at` is refreshed at most this often. */
export const assistantTokenTouchIntervalMs = 5 * 60_000
