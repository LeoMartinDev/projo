import { createContext, createElement, type ReactNode, useContext } from 'react'

import type { WebPlayerEngine } from './features/player/web-engine.ts'
import type { EventsContext, EventSourceLike } from './shared/events/events.ts'

export type { EventsContext, EventSourceLike }

/**
 * What the update banner offers (§16.4, §28.10): `reload` a newer web app the server serves,
 * `restart` on a desktop app downloaded and ready.
 */
export type UpdateOffer = 'reload' | 'restart'

/** What the app tells the host's update source when it starts it. */
export type UpdateContext = {
  /** The server's event stream came back after a drop (the server may have restarted). */
  onReconnect: (listener: () => void) => () => void
  /** A video plays: nothing reloads under it. */
  isPlaying: () => boolean
}

/** An external store the update banner reads; the host owns where updates come from. */
export type HostUpdates = {
  /** Starts watching, once per page; returns the function that stops. */
  start: (app: UpdateContext) => () => void
  /** The update on offer, if any; the same value until it changes. */
  offered: () => UpdateOffer | undefined
  subscribe: (listener: () => void) => () => void
  /** Takes the offer (reload, restart); rejects when it could not, so the banner can retry. */
  apply: () => Promise<void>
}

/**
 * How the page holds its session (§20).
 * - `cookie`: the server sets an httpOnly cookie at sign-in; the page never sees a credential.
 * - `token`: sign-in asks for a bearer token (`token: true` and `deviceName`, like the mobile
 *   app) and hands it to the host, which keeps it and sends it from `apiFetch`, `openEvents`,
 *   `download` and `sendLeave`.
 */
export type HostSession =
  | { kind: 'cookie' }
  | {
      kind: 'token'
      /** Sent with sign-in (`deviceName`), named in the account's devices. */
      deviceName: string
      /** Keeps the token sign-in returned; resolves once requests carry it. */
      keep: (token: string) => Promise<void>
      /** The session is over (signed out, or a request answered 401): forgets the token. */
      drop: () => Promise<void>
    }

/** What the system's media controls can ask of the player (keys, overlays, lock screen). */
export type SystemMediaAction =
  'play' | 'pause' | 'seekbackward' | 'seekforward' | 'seekto' | 'nexttrack'

/** An action the system asked for; `seekto` carries where to, in milliseconds. */
export type SystemMediaRequest =
  { action: Exclude<SystemMediaAction, 'seekto'> } | { action: 'seekto'; seekTimeMs: number }

/** What the system shows of the playing title (§10.7). */
export type NowPlaying = {
  /** Shown first: the movie's title, or the episode's line. */
  title: string
  /** The series (absent for a movie). */
  subtitle?: string
  /** The poster, already through `mediaUrl()` (absolute on the desktop). */
  artworkUrl?: string
  /** The actions the system offers (`nexttrack` only with a next episode). */
  actions: readonly SystemMediaAction[]
}

/** Where playback is, for the system's timeline. */
export type SystemMediaPosition = {
  playing: boolean
  positionMs: number
  durationMs: number
  rate: number
}

/**
 * The system's media controls: the Media Session in the browser, Windows' System Media Transport
 * Controls on the desktop (over IPC). The player sets what plays, posts its position and listens
 * to the actions; `clear` when it goes away.
 */
export type SystemMedia = {
  set: (nowPlaying: NowPlaying) => void
  position: (position: SystemMediaPosition) => void
  clear: () => void
  /** Listens to the actions the system asks for; returns the function that stops. */
  onAction: (listener: (request: SystemMediaRequest) => void) => () => void
}

/** A row the host adds to Account → About (§28: the desktop app's version). */
export type AboutRow = { label: 'desktopApp'; value: string }

/**
 * What the app needs from the page that mounts it: the browser host (`apps/web`) or the desktop
 * host (`apps/desktop`, §28). Everything that differs between them goes through here; the app
 * never tests which host it runs in.
 */
export type AppHost = {
  /**
   * Version of this build: the web app's in the browser (`__PROJO_VERSION__`, the root
   * `package.json`'s, compared with the server's), the desktop app's own on the desktop
   * (`apps/desktop/package.json`, §28.10).
   */
  version: string
  /**
   * Whether the app is the one the server serves (the browser: `true`), so that it follows the
   * server's version (§16.4: "web app outdated", "Reload the app"). `false` when it ships with
   * the host and updates with it (the desktop app, §28.10): no comparison, no reload offer.
   */
  uiFromServer: boolean
  /**
   * Origin of the server, without a trailing slash: `''` when the page is served by the server
   * (the browser: every URL stays root-relative), `http://nas.local:8080` for the desktop app.
   */
  serverOrigin: string
  /**
   * `fetch` for the API and the app's raw requests. `path` is root-relative (`/api/v1/…`,
   * `/health`): the host resolves it against `serverOrigin` and adds its credentials (the
   * browser: the cookie; the desktop: `Authorization: Bearer`). The app adds `X-Profile-Id`.
   */
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  /**
   * Opens the server's event stream (`/api/v1/events`, §17): `EventSource` in the browser, a
   * `fetch` stream carrying the bearer on the desktop (`createFetchEvents` of
   * `@projo/web-app/fetch-event-source`: it calls `events.unauthorized` on a 401 and backs off on
   * other refusals). The app reopens it after an `error` that closed it.
   */
  openEvents: (events: EventsContext) => EventSourceLike
  /**
   * Saves what `path` (root-relative, a GET) answers as a file: a link in the browser; a `fetch`
   * with the bearer then a blob on the desktop. The server names the file (`Content-Disposition`);
   * `filename` is the fallback.
   */
  download: (path: string, filename: string) => void
  /**
   * Sends a last request while the page goes away (the player's final heartbeat, §11.3): POST of
   * the JSON `body` to `path` (root-relative). `sendBeacon` in the browser, a `keepalive` fetch
   * with the bearer on the desktop.
   */
  sendLeave: (path: string, body: string) => void
  /** Cookie or bearer token (see `HostSession`). */
  session: HostSession
  /**
   * The playback engine (§10.7), asked once per page by the player route: `html-video` in the
   * browser, libmpv on the desktop (`@projo/web-app/engines/mpv`, html-video as its fallback).
   */
  playerEngine: () => WebPlayerEngine | Promise<WebPlayerEngine>
  /** The system's media controls, driven by the player (see `SystemMedia`). */
  systemMedia: SystemMedia
  /**
   * Window chrome drawn over every page (the desktop's frameless window buttons, §28.4). It keeps
   * pages clear of itself by setting `--chrome-inset` on `:root` while shown.
   */
  chrome?: ReactNode
  /** What the update banner offers (the server's new web app, or the desktop app's update). */
  updates: HostUpdates
  /** Extra rows of Account → About (the desktop app's version); none in the browser. */
  aboutRows?: () => Promise<readonly AboutRow[]>
  /** Reloads on the latest build of the app (after a server update). */
  reloadToLatest: () => Promise<void>
  /** Reloads from scratch, dropping any cached build (Admin → Updates → reload the app). */
  reloadFresh: () => Promise<void>
}

const HostContext = createContext<AppHost | undefined>(undefined)

export const HostProvider = ({ host, children }: { host: AppHost; children: ReactNode }) =>
  createElement(HostContext.Provider, { value: host }, children)

export const useHost = (): AppHost => {
  const host = useContext(HostContext)
  if (host === undefined) throw new Error('useHost() outside of <HostProvider>')
  return host
}

/** The server's absolute origin, what another device or the system browser reaches it at. */
export const serverAddress = (serverOrigin: string, pageOrigin: string): string =>
  serverOrigin === '' ? pageOrigin : serverOrigin

export const useServerAddress = (): string =>
  serverAddress(useHost().serverOrigin, window.location.origin)
