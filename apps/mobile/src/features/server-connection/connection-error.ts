import { type Failure, failure } from '../../shared/api/failure.ts'

/** What fails while reaching the server, before any API call. */
export type ConnectionErrorCode =
  'connection/invalid_url' | 'connection/not_projo' | 'network' | 'unknown'

export type ConnectionError<Code extends ConnectionErrorCode = ConnectionErrorCode> = Failure<Code>

export const connectionError = failure
