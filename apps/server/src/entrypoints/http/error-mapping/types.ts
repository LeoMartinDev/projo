import type { ClientErrorStatusCode, ServerErrorStatusCode } from 'hono/utils/http-status'

import type { ErrorCode } from '@projo/shared'

/**
 * 4xx or 5xx only: an error response never types as `ok: true`, so the RPC client narrows the
 * success body on `response.ok` without a cast.
 */
export type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode

/** One file per domain: every code of the domain maps to an HTTP status (§5.3). */
export type ErrorStatusMap<Code extends ErrorCode> = Record<Code, ErrorStatusCode>
