import { z } from 'zod'

import type { McpTool, ToolContext } from './tool.ts'

/**
 * The MCP protocol of `POST /mcp` (§27.2): JSON-RPC 2.0, stateless, one message per request,
 * tools only. Hand-written: the surface is small and the SDK's transports target Node servers.
 */

/** Newest first; an unknown version asked by a client gets the newest. */
export const supportedProtocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26'] as const

const jsonRpcIdSchema = z.union([z.string(), z.number()])

const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: jsonRpcIdSchema.optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
})

type JsonRpcId = z.infer<typeof jsonRpcIdSchema>

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: Record<string, unknown> }
  | {
      jsonrpc: '2.0'
      /** Absent: the request could not be read far enough to know its id. */
      id?: JsonRpcId
      error: { code: number; message: string; data?: unknown }
    }

/** JSON-RPC 2.0 error codes. */
export const rpcErrors = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const

const failure = (id: JsonRpcId | undefined, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  error: { code, message },
})

const callParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
})

const initializeParamsSchema = z.object({ protocolVersion: z.string() }).loose()

type ServerInfo = { name: string; version: string; instructions: string }

/**
 * One JSON-RPC message → its response, or `undefined` for a notification (answered 202 with no
 * body). `onToolCall` hears every call, for the logs.
 */
export const createMcpProtocol = ({
  tools,
  server,
  onToolCall,
}: {
  tools: readonly McpTool[]
  server: ServerInfo
  onToolCall: (entry: {
    tool: string
    targets: Record<string, unknown>
    durationMs: number
    errorCode?: string
  }) => void
}) => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const listed = tools.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations,
  }))

  const callTool = async (
    id: JsonRpcId,
    params: Record<string, unknown> | undefined,
    context: ToolContext,
  ): Promise<JsonRpcResponse> => {
    const call = callParamsSchema.safeParse(params)
    if (!call.success) return failure(id, rpcErrors.invalidParams, 'invalid tools/call params')
    const tool = byName.get(call.data.name)
    if (tool === undefined) {
      return failure(id, rpcErrors.invalidParams, `unknown tool: ${call.data.name}`)
    }
    const startedAt = performance.now()
    const outcome = await tool.call(call.data.arguments, context)
    const log = {
      tool: tool.name,
      targets: tool.targets(call.data.arguments),
      durationMs: Math.round(performance.now() - startedAt),
    }
    if (outcome.kind === 'invalid_arguments') {
      onToolCall({ ...log, errorCode: 'common/validation_failed' })
      return failure(id, rpcErrors.invalidParams, outcome.message)
    }
    if (outcome.kind === 'failed') {
      const { code, message, context: errorContext } = outcome.error
      onToolCall({ ...log, errorCode: code })
      // §27.6: the projo error, never its cause, so the assistant can explain it or retry.
      const body = {
        code,
        message,
        ...(errorContext === undefined ? {} : { context: errorContext }),
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ error: body }) }],
          structuredContent: { error: body },
          isError: true,
        },
      }
    }
    onToolCall(log)
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(outcome.value) }],
        structuredContent: outcome.value,
      },
    }
  }

  return {
    handle: async (
      message: unknown,
      context: ToolContext,
    ): Promise<JsonRpcResponse | undefined> => {
      if (Array.isArray(message)) {
        return failure(undefined, rpcErrors.invalidRequest, 'batches are not supported')
      }
      const request = requestSchema.safeParse(message)
      if (!request.success) return failure(undefined, rpcErrors.invalidRequest, 'invalid request')
      const { id, method, params } = request.data
      // Notifications (`notifications/initialized`, `notifications/cancelled`…): nothing to do.
      if (id === undefined) return undefined

      switch (method) {
        case 'initialize': {
          const asked = initializeParamsSchema.safeParse(params)
          const version =
            asked.success &&
            (supportedProtocolVersions as readonly string[]).includes(asked.data.protocolVersion)
              ? asked.data.protocolVersion
              : supportedProtocolVersions[0]
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: version,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: server.name, version: server.version },
              instructions: server.instructions,
            },
          }
        }
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} }
        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: listed } }
        case 'tools/call':
          return callTool(id, params, context)
        default:
          return failure(id, rpcErrors.methodNotFound, `method not found: ${method}`)
      }
    },
  }
}

export type McpProtocol = ReturnType<typeof createMcpProtocol>
