export type AssistantToken = {
  id: string
  accountId: string
  profileId: string
  kind: 'token' | 'oauth'
  clientId?: string
  name: string
  tokenHash?: string
  createdAt: Date
  lastUsedAt?: Date
  revokedAt?: Date
}

export type AssistantTokenRepository = {
  create: (token: AssistantToken) => AssistantToken
  findById: (id: string) => AssistantToken | undefined
  findByTokenHash: (tokenHash: string) => AssistantToken | undefined
  listActiveByAccount: (accountId: string) => AssistantToken[]
  revoke: (input: { id: string; accountId?: string; revokedAt: Date }) => boolean
  touch: (input: { id: string; lastUsedAt: Date }) => void
}

export const assistantTokenTouchIntervalMs = 5 * 60_000
