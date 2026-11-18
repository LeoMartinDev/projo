import type { LiveSession, LiveSessionRepository } from '../../core/tv/live-session.ts'

/** Live sessions in memory: like the streams they watch, they end with the process (§29.4). */
export const createLiveSessionStore = (): LiveSessionRepository => {
  const sessions = new Map<string, LiveSession>()
  return {
    insert: (session) => {
      sessions.set(session.id, session)
    },
    findById: (id) => sessions.get(id),
    heartbeat: ({ id, at }) => {
      const session = sessions.get(id)
      if (session !== undefined) sessions.set(id, { ...session, lastHeartbeatAt: at })
    },
    setRendition: ({ id, rendition }) => {
      const session = sessions.get(id)
      if (session !== undefined) sessions.set(id, { ...session, rendition })
    },
    remove: (id) => {
      sessions.delete(id)
    },
    list: () =>
      [...sessions.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()),
  }
}
