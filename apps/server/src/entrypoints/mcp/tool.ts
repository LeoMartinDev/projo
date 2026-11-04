import { z } from 'zod'

import type { AppError, Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'

/** Who calls a tool (§27.3): an admin account, acting as one of its unrestricted profiles. */
export type ToolContext = {
  accountId: string
  profileId: string
  logger: Logger
}

/** MCP tool annotations: the client asks before a write, warns before a destructive one. */
export type ToolAnnotations = {
  readOnlyHint: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** Every tool answers an object (`structuredContent` must be one). */
export type ToolValue = Record<string, unknown>

export type ToolOutcome =
  | { kind: 'ok'; value: ToolValue }
  | { kind: 'invalid_arguments'; message: string }
  | { kind: 'failed'; error: AppError }

/** A tool as `tools/list` describes it and `tools/call` runs it (§27.4). */
export type McpTool = {
  name: string
  title: string
  description: string
  /** JSON Schema of the arguments, from the Zod schema that validates them (§27.6). */
  inputSchema: Record<string, unknown>
  annotations: ToolAnnotations
  call: (args: unknown, context: ToolContext) => Promise<ToolOutcome>
  /** Ids worth logging (`sourceId`, `itemId`…), never the whole arguments. */
  targets: (args: unknown) => Record<string, unknown>
}

const targetKeys = ['sourceId', 'itemId', 'tmdbId', 'libraryId'] as const

/**
 * A tool from a Zod schema of its arguments: the schema is published as `inputSchema` and checked
 * before `run`; an expected failure is a `Result` error, sent back as a tool error (`isError`).
 */
export const defineTool = <S extends z.ZodObject>({
  name,
  title,
  description,
  input,
  annotations,
  run,
}: {
  name: string
  title: string
  description: string
  input: S
  annotations: ToolAnnotations
  run: (
    args: z.output<S>,
    context: ToolContext,
  ) => Promise<Result<ToolValue, AppError>> | Result<ToolValue, AppError>
}): McpTool => {
  const { $schema: _dialect, ...inputSchema } = z.toJSONSchema(input, { io: 'input' })
  return {
    name,
    title,
    description,
    inputSchema,
    annotations,
    call: async (args, context) => {
      const parsed = input.safeParse(args ?? {})
      if (!parsed.success) {
        return { kind: 'invalid_arguments', message: z.prettifyError(parsed.error) }
      }
      const result = await run(parsed.data, context)
      return result.ok
        ? { kind: 'ok', value: result.value }
        : { kind: 'failed', error: result.error }
    },
    targets: (args) => {
      if (typeof args !== 'object' || !args || Array.isArray(args)) return {}
      const record = args as Record<string, unknown>
      return Object.fromEntries(
        targetKeys.flatMap((key) => (record[key] === undefined ? [] : [[key, record[key]]])),
      )
    },
  }
}
