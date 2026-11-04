import { z } from 'zod'

/**
 * Assistant tokens of the MCP server (§27.3): created by an admin in Admin → Server → "AI
 * assistants", accepted on `POST /mcp` only. The token itself is returned once, at creation.
 */

/** Path of the MCP endpoint, outside `/api/v1` (§27.2). */
export const mcpPath = '/mcp'

export const assistantTokenNameSchema = z.string().trim().min(1).max(64)

/** `POST /admin/assistant-tokens`. */
export const createAssistantTokenBodySchema = z.object({ name: assistantTokenNameSchema })
export type CreateAssistantTokenBody = z.infer<typeof createAssistantTokenBodySchema>

/**
 * A row of "AI assistants". `kind`: a token created here, or an OAuth connection (ChatGPT, Claude
 * connector…), named after its client. `profileId`: the profile the assistant acts as.
 */
export const assistantTokenDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['token', 'oauth']),
  name: z.string(),
  profileId: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
})
export type AssistantTokenDto = z.infer<typeof assistantTokenDtoSchema>

/** `GET /admin/assistant-tokens`: the live tokens of the signed-in account, newest first. */
export const assistantTokensResponseSchema = z.object({ items: z.array(assistantTokenDtoSchema) })
export type AssistantTokensResponse = z.infer<typeof assistantTokensResponseSchema>

/** `POST /admin/assistant-tokens` (201): the token, shown once, and its row. */
export const createdAssistantTokenSchema = z.object({
  token: z.string(),
  assistant: assistantTokenDtoSchema,
})
export type CreatedAssistantToken = z.infer<typeof createdAssistantTokenSchema>
