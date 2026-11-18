import { appError, type AppError, err, ok, type Result } from '@projo/shared'

/**
 * A holder of (or about to hold) one of its source's connections (§29.4): a channel's stream, or
 * a background snapshot grab (`grab`, channel snapshots of §29.4).
 */
export type LiveConnection = {
  channelId: string
  viewers: number
  /** Order in which streams lost their last viewer (lower: idle longer). */
  idleOrder?: number
  /** A background snapshot grab: stopped before any idle stream. */
  grab?: boolean
}

export type LiveConnectionError = AppError<'tv/connection_limit_reached'>

/**
 * What starting one more stream of a source needs (§29.4): nothing under the limit; else the
 * holders to stop, the source's snapshot grabs first, then its streams without viewers, the one
 * idle the longest first, only as many as needed; refused when there are not enough of them.
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
  const grabs = connections.filter((connection) => connection.grab === true)
  const idle = connections
    .filter((connection) => connection.grab !== true && connection.viewers === 0)
    .sort((a, b) => (a.idleOrder ?? 0) - (b.idleOrder ?? 0))
  const stoppable = [...grabs, ...idle]
  if (stoppable.length < needed) {
    return err(
      appError('tv/connection_limit_reached', "all the provider's connections are in use", {
        context: { sourceId, maxConnections },
      }),
    )
  }
  return ok({ evict: stoppable.slice(0, needed).map((connection) => connection.channelId) })
}

/** Connections a background grab always leaves free: never the source's last one (§29.4). */
export const grabFreeConnections = 2

/**
 * Whether a source may open a background snapshot grab (§29.4): always without a limit; else
 * only while at least two of its connections are free, counting every holder and every stop
 * still under way (`used`).
 */
export const canOpenGrab = ({
  used,
  maxConnections,
}: {
  used: number
  maxConnections: number | undefined
}): boolean => maxConnections === undefined || maxConnections - used >= grabFreeConnections
