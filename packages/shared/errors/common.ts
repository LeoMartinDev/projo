export const commonErrorCodes = [
  'common/internal',
  'common/validation_failed',
  'common/not_found',
  /** `GET` / `DELETE /mcp`: the MCP endpoint is stateless, POST only (§27.2). */
  'common/method_not_allowed',
] as const

export type CommonErrorCode = (typeof commonErrorCodes)[number]
