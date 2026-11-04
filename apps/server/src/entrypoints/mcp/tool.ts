import { z } from 'zod'

import type { AppError, Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'

export type ToolContext = {
  accountId: string
  profileId: string
  logger: Logger
}

export type ToolAnnotations = {
  readOnlyHint: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export type ToolValue = Record<string, unknown>

export type ToolOutcome =
  | { kind: 'ok'; value: ToolValue }
  | { kind: 'invalid_arguments'; message: string }
  | { kind: 'failed'; error: AppError }

export type McpTool = {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: ToolAnnotations
  call: (args: unknown, context: ToolContext) => Promise<ToolOutcome>
  targets: (args: unknown) => Record<string, unknown>
}

const targetKeys = ['sourceId', 'itemId', 'tmdbId', 'libraryId'] as const

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
