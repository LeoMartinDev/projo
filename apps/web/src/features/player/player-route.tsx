import { use } from 'react'

import { htmlVideoEngine } from './engines/html-video/html-video-engine.ts'
import { PlayerPage } from './ui/PlayerPage.tsx'
import type { WebPlayerEngine } from './web-engine.ts'

/**
 * The only place that picks the playback engine. The UI never imports an
 * engine: it decides on `engine.capabilities`.
 */
const choosePlayerEngine = (): WebPlayerEngine | Promise<WebPlayerEngine> => {
  // Desktop app (Tauri, §28): `window.__TAURI_INTERNALS__` will select the mpv
  // engine here, loaded by a dynamic import so it never weighs on the browser
  // bundle's main chunk:
  //   if ('__TAURI_INTERNALS__' in window)
  //     return import('./engines/mpv/mpv-engine.ts').then((module) => module.createMpvEngine())
  return htmlVideoEngine()
}

let chosen: WebPlayerEngine | Promise<WebPlayerEngine> | undefined

const playerEngine = () => {
  chosen ??= choosePlayerEngine()
  return chosen
}

export const PlayerRoute = ({ itemId, fromStart }: { itemId: string; fromStart: boolean }) => {
  const choice = playerEngine()
  const engine = choice instanceof Promise ? use(choice) : choice
  return <PlayerPage itemId={itemId} fromStart={fromStart} engine={engine} />
}
