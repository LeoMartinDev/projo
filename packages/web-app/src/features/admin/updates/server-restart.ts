/** What following a server's restart after its update needs (§16.4). */
export type ServerRestartDeps = {
  /** The version the server ran before its update. */
  from: string
  /** The version `/health` answers now; `undefined` while the server is down. */
  readVersion: () => Promise<string | undefined>
  /** Waits before the next look at the server. */
  wait: () => Promise<void>
  /** The page stopped watching (it went away, or the restart was dealt with elsewhere). */
  stopped: () => boolean
  /** `AppHost.reloadToLatest`: the browser reloads on the server's new web app, the desktop stays. */
  reloadToLatest: () => Promise<void>
  /** Refreshes what the page shows from the restarted server, and ends the "restarting" state. */
  refresh: () => Promise<void>
}

/**
 * Follows a server restarting on its new version: once it answers again (it was seen down, or it
 * answers another version), the host reloads on the latest app if it takes it from the server, and
 * the page refreshes its data in place otherwise (the desktop app, whose UI ships with it). Resolves
 * once done, or once stopped.
 */
export const followServerRestart = async ({
  from,
  readVersion,
  wait,
  stopped,
  reloadToLatest,
  refresh,
}: ServerRestartDeps): Promise<void> => {
  let sawDown = false
  while (!stopped()) {
    await wait()
    const version = await readVersion()
    if (stopped()) return
    if (version === undefined) {
      sawDown = true
      continue
    }
    if (sawDown || version !== from) {
      await reloadToLatest()
      if (!stopped()) await refresh()
      return
    }
  }
}
