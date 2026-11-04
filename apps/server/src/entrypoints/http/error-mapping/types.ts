import type { ClientErrorStatusCode, ServerErrorStatusCode } from 'hono/utils/http-status'

import type { ErrorCode } from '@projo/shared'

export type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode

export type ErrorStatusMap<Code extends ErrorCode> = Record<Code, ErrorStatusCode>
