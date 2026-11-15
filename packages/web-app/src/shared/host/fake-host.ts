// Tests only: an AppHost whose every part is a recording fake, bound as the page's host.
import type { AppHost, HostSession } from '../../host.ts'
import { bindHost } from './bound-host.ts'

export type FakeServer = (path: string, init?: RequestInit) => Response | Promise<Response>

export const bindFakeHost = ({
  serverOrigin = 'http://nas.local:8080',
  server = () => Response.json({}),
  session = { kind: 'cookie' },
}: { serverOrigin?: string; server?: FakeServer; session?: HostSession } = {}) => {
  const requests: { path: string; headers: Headers; method: string }[] = []
  const unused = () => {
    throw new Error('not used by this test')
  }
  const host: AppHost = {
    version: '0.0.0',
    uiFromServer: true,
    serverOrigin,
    apiFetch: async (path, init) => {
      requests.push({ path, headers: new Headers(init?.headers), method: init?.method ?? 'GET' })
      return server(path, init)
    },
    openEvents: unused,
    download: unused,
    sendLeave: unused,
    session,
    playerEngine: unused,
    systemMedia: {
      set: () => undefined,
      position: () => undefined,
      clear: () => undefined,
      onAction: () => () => undefined,
    },
    updates: {
      start: () => () => undefined,
      offered: () => undefined,
      subscribe: () => () => undefined,
      apply: async () => undefined,
    },
    reloadToLatest: async () => undefined,
    reloadFresh: async () => undefined,
  }
  bindHost(host)
  return { host, requests }
}

/** A token session recording what the app asks of it. */
export const recordingTokenSession = () => {
  const calls: string[] = []
  const session: HostSession = {
    kind: 'token',
    deviceName: 'projo desktop · Windows',
    keep: async (token) => {
      calls.push(`keep:${token}`)
    },
    drop: async () => {
      calls.push('drop')
    },
  }
  return { session, calls }
}
