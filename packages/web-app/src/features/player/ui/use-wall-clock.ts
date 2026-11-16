import { useSyncExternalStore } from 'react'

const minuteMs = 60_000

// The time of day, read again on every render (to the second, so that two
// reads in one render agree) and at each turn of the minute, so that what the
// page derives from it (the end time of §10.7) stays current while paused.
const nowToTheSecond = () => Math.floor(Date.now() / 1000) * 1000

const subscribeMinutes = (notify: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    timer = setTimeout(
      () => {
        notify()
        schedule()
      },
      minuteMs - (Date.now() % minuteMs),
    )
  }
  schedule()
  return () => clearTimeout(timer)
}

export const useWallClock = (): number =>
  useSyncExternalStore(subscribeMinutes, nowToTheSecond, nowToTheSecond)
