import { Hono } from 'hono'

import {
  type AssistantTokenDto,
  type AssistantTokensResponse,
  type CreatedAssistantToken,
  createAssistantTokenBodySchema,
} from '@projo/shared/api/assistants'

import type { CreateAssistantToken } from '../../../application/auth/create-assistant-token.ts'
import type { ListAssistantTokens } from '../../../application/auth/list-assistant-tokens.ts'
import type { RevokeAssistantToken } from '../../../application/auth/revoke-assistant-token.ts'
import type { AssistantToken } from '../../../core/auth/assistant-token.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal, currentProfileId } from '../principal.ts'
import { noContent } from '../responses.ts'
import { validate } from '../validation.ts'

const toAssistantTokenDto = (token: AssistantToken): AssistantTokenDto => ({
  id: token.id,
  kind: token.kind,
  name: token.name,
  profileId: token.profileId,
  createdAt: token.createdAt.toISOString(),
  ...(token.lastUsedAt === undefined ? {} : { lastUsedAt: token.lastUsedAt.toISOString() }),
})

export const adminAssistantsRoutes = ({
  listAssistantTokens,
  createAssistantToken,
  revokeAssistantToken,
}: {
  listAssistantTokens: ListAssistantTokens
  createAssistantToken: CreateAssistantToken
  revokeAssistantToken: RevokeAssistantToken
}) =>
  new Hono<AppEnv>()
    .get('/assistant-tokens', (c) => {
      const { account } = currentPrincipal(c)
      const body: AssistantTokensResponse = {
        items: listAssistantTokens({ accountId: account.id }).map(toAssistantTokenDto),
      }
      return c.json(body, 200)
    })
    .post('/assistant-tokens', validate('json', createAssistantTokenBodySchema), (c) => {
      const { account } = currentPrincipal(c)
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const { token, assistant } = createAssistantToken({
        accountId: account.id,
        profileId: profileId.value,
        name: c.req.valid('json').name,
      })
      const body: CreatedAssistantToken = { token, assistant: toAssistantTokenDto(assistant) }
      return c.json(body, 201)
    })
    .delete('/assistant-tokens/:id', (c) => {
      const { account } = currentPrincipal(c)
      const result = revokeAssistantToken({ id: c.req.param('id'), accountId: account.id })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })

export type AdminAssistantsRoutes = ReturnType<typeof adminAssistantsRoutes>
