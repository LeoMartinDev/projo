import { appError, type AppError, err, ok, type Result } from '@projo/shared'

/** A stream holding (or about to hold) one of its source's connections (§29.4). */
export type LiveConnection = {
  channelId: string
  viewers: number
  /** Order in which streams lost their last viewer (lower: idle longer). */
  idleOrder?: number
}

export type LiveConnectionError = AppError<'tv/connection_limit_reached'>

/**
 * What starting one more stream of a source needs (§29.4): nothing under the limit; else the
 * streams without viewers to stop, the one idle the longest first and only as many as needed;
 * refused when there are not enough of them.
 */
export const planLiveConnection = ({
  connections,
  maxConnections,
  sourceId,
}: {
  connections: readonly LiveConnection[]
  maxConnections: number | undefined
  sourceId: string
}): Result<{ evict: string[] }, LiveConnectionError> => {
  if (maxConnections === undefined || connections.length < maxConnections) return ok({ evict: [] })
  const needed = connections.length - maxConnections + 1
  const idle = connections
    .filter((connection) => connection.viewers === 0)
    .sort((a, b) => (a.idleOrder ?? 0) - (b.idleOrder ?? 0))
  if (idle.length < needed) {
    return err(
      appError('tv/connection_limit_reached', "all the provider's connections are in use", {
        context: { sourceId, maxConnections },
      }),
    )
  }
  return ok({ evict: idle.slice(0, needed).map((connection) => connection.channelId) })
}
