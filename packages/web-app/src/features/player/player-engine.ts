import type { AppHost } from '../../host.ts'
import type { WebPlayerEngine } from './web-engine.ts'

let chosen: WebPlayerEngine | Promise<WebPlayerEngine> | undefined

/**
 * The only place that asks for the playback engine, once per page: the host picks it (§10.7).
 * The player routes (a title's, a channel's) read it; the UI never imports an engine and
 * decides on `engine.capabilities`.
 */
export const playerEngine = (host: AppHost): WebPlayerEngine | Promise<WebPlayerEngine> => {
  chosen ??= host.playerEngine()
  return chosen
}
