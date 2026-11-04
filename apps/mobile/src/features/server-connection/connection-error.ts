import { type Failure, failure } from '../../shared/api/failure.ts'

export type ConnectionErrorCode =
  'connection/invalid_url' | 'connection/not_projo' | 'network' | 'unknown'

export type ConnectionError<Code extends ConnectionErrorCode = ConnectionErrorCode> = Failure<Code>

export const connectionError = failure
