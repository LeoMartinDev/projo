import { startIptvServer } from '../../apps/server/test/support/iptv-server.ts'

import { iptvPort } from './paths.ts'

// Preloaded into the server (scripts/serve.ts), where ffmpeg runs (the runtime image in CI): the
// IPTV provider of journey 6 (§29.8), its playlists and endless live streams, never a real one.
// Its port is fixed (the test hands the playlist URL to the admin page): one already taken fails
// here, with a message, rather than as a refresh error in the journey.
try {
  startIptvServer({ port: iptvPort })
} catch (cause) {
  console.error(
    `e2e: the IPTV provider cannot listen on port ${iptvPort} (${String(cause)}): stop what holds it (an earlier e2e server?)`,
  )
  process.exit(1)
}
