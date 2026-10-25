import type { Clock } from '../../core/clock.ts'

export const systemClock: Clock = { now: () => new Date() }
