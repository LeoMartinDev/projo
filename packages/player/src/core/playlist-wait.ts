export const KEYFRAME_WAIT_RETRIES = 15

export type PlaylistWait = 'ready' | 'cancelled'

export const waitForPlaylist = async ({
  status,
  delay,
  cancelled,
  retries = KEYFRAME_WAIT_RETRIES,
}: {
  status: () => Promise<number>
  delay: (ms: number) => Promise<void>
  cancelled: () => boolean
  retries?: number
}): Promise<PlaylistWait> => {
  for (let attempt = 0; ; attempt += 1) {
    const answer = await status()
    if (cancelled()) return 'cancelled'
    if (answer !== 503 || attempt >= retries) return 'ready'
    await delay(Math.min(1000 * 2 ** attempt, 2000))
    if (cancelled()) return 'cancelled'
  }
}
