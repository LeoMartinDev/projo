import { use } from 'react'

import { useHost } from '../../host.ts'
import { playerEngine } from './player-engine.ts'
import { LivePlayerPage } from './ui/LivePlayerPage.tsx'

/** A channel's live player (§29.5), on the engine the host picked. */
export const LivePlayerRoute = ({ channelId }: { channelId: string }) => {
  const choice = playerEngine(useHost())
  const engine = choice instanceof Promise ? use(choice) : choice
  return <LivePlayerPage channelId={channelId} engine={engine} />
}
