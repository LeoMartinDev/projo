import { use } from 'react'

import { type AppHost, useHost } from '../../host.ts'
import { PlayerPage } from './ui/PlayerPage.tsx'
import type { WebPlayerEngine } from './web-engine.ts'

let chosen: WebPlayerEngine | Promise<WebPlayerEngine> | undefined

/**
 * The only place that asks for the playback engine, once per page: the host picks it (§10.7).
 * The UI never imports an engine: it decides on `engine.capabilities`.
 */
const playerEngine = (host: AppHost) => {
  chosen ??= host.playerEngine()
  return chosen
}

export const PlayerRoute = ({ itemId, fromStart }: { itemId: string; fromStart: boolean }) => {
  const choice = playerEngine(useHost())
  const engine = choice instanceof Promise ? use(choice) : choice
  return <PlayerPage itemId={itemId} fromStart={fromStart} engine={engine} />
}
