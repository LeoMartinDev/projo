import type { AssistantToken, AssistantTokenRepository } from '../../core/auth/assistant-token.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  assistantTokenRepository: Pick<AssistantTokenRepository, 'create'>
  tokens: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export const createAssistantTokenFactory =
  ({ assistantTokenRepository, tokens, clock, ids, logger }: Deps) =>
  ({
    accountId,
    profileId,
    name,
  }: {
    accountId: string
    profileId: string
    name: string
  }): { token: string; assistant: AssistantToken } => {
    const token = tokens.generate()
    const assistant = assistantTokenRepository.create({
      id: ids.next(),
      accountId,
      profileId,
      kind: 'token',
      name,
      tokenHash: tokens.hash(token),
      createdAt: clock.now(),
    })
    logger.info('assistant token created', { accountId, assistantTokenId: assistant.id })
    return { token, assistant }
  }

export type CreateAssistantToken = ReturnType<typeof createAssistantTokenFactory>
