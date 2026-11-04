import { z } from 'zod'

export const mcpPath = '/mcp'

export const assistantTokenNameSchema = z.string().trim().min(1).max(64)

export const createAssistantTokenBodySchema = z.object({ name: assistantTokenNameSchema })
export type CreateAssistantTokenBody = z.infer<typeof createAssistantTokenBodySchema>

export const assistantTokenDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['token', 'oauth']),
  name: z.string(),
  profileId: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
})
export type AssistantTokenDto = z.infer<typeof assistantTokenDtoSchema>

export const assistantTokensResponseSchema = z.object({ items: z.array(assistantTokenDtoSchema) })
export type AssistantTokensResponse = z.infer<typeof assistantTokensResponseSchema>

export const createdAssistantTokenSchema = z.object({
  token: z.string(),
  assistant: assistantTokenDtoSchema,
})
export type CreatedAssistantToken = z.infer<typeof createdAssistantTokenSchema>
