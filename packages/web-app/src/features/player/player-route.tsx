import { use } from 'react'

import { useHost } from '../../host.ts'
import { playerEngine } from './player-engine.ts'
import { PlayerPage } from './ui/PlayerPage.tsx'

export const PlayerRoute = ({ itemId, fromStart }: { itemId: string; fromStart: boolean }) => {
  const choice = playerEngine(useHost())
  const engine = choice instanceof Promise ? use(choice) : choice
  return <PlayerPage itemId={itemId} fromStart={fromStart} engine={engine} />
}
