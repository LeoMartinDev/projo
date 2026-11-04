import type { Clock } from '../../src/core/clock.ts'

export const createManualClock = (start: Date = new Date('2026-01-01T00:00:00.000Z')) => {
  let current = start.getTime()
  const clock = {
    now: () => new Date(current),
    set: (date: Date) => {
      current = date.getTime()
    },
    advance: (ms: number) => {
      current += ms
    },
  }
  return clock satisfies Clock
}
export type ManualClock = ReturnType<typeof createManualClock>
