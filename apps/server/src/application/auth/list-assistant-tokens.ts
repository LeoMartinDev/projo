import type { AssistantToken, AssistantTokenRepository } from '../../core/auth/assistant-token.ts'

type Deps = { assistantTokenRepository: Pick<AssistantTokenRepository, 'listActiveByAccount'> }

export const listAssistantTokensFactory =
  ({ assistantTokenRepository }: Deps) =>
  ({ accountId }: { accountId: string }): AssistantToken[] =>
    assistantTokenRepository.listActiveByAccount(accountId)

export type ListAssistantTokens = ReturnType<typeof listAssistantTokensFactory>
