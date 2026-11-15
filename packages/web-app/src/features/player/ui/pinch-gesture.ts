// Pinching in on the touch surface of the player closes it (§10.7). The video
// shrinks with the fingers (never below `pinchMinScale`, never above full size:
// pinching out does nothing); letting go at or below `pinchCloseScale`, or while
// the fingers are still closing fast, closes the player, otherwise the video
// goes back to full size.

export type PinchPoint = { x: number; y: number }

type PinchSample = { time: number; scale: number }

export type Pinch = {
  startDistance: number
  scale: number
  // The samples of the last `velocityWindowMs`, oldest first.
  recent: readonly PinchSample[]
}

export const pinchMinScale = 0.4
export const pinchCloseScale = 0.75
// Scale lost per second that closes whatever the scale.
export const pinchFlingSpeed = 1.5
export const velocityWindowMs = 120

export const distanceBetween = (a: PinchPoint, b: PinchPoint) => Math.hypot(a.x - b.x, a.y - b.y)

export const pinchScale = (startDistance: number, distance: number) =>
  startDistance <= 0 ? 1 : Math.min(1, Math.max(pinchMinScale, distance / startDistance))

export const pinchStarted = (a: PinchPoint, b: PinchPoint, time: number): Pinch => ({
  startDistance: distanceBetween(a, b),
  scale: 1,
  recent: [{ time, scale: 1 }],
})

const within = (samples: readonly PinchSample[], time: number) =>
  samples.filter((sample) => time - sample.time <= velocityWindowMs)

export const pinchMoved = (pinch: Pinch, a: PinchPoint, b: PinchPoint, time: number): Pinch => {
  const scale = pinchScale(pinch.startDistance, distanceBetween(a, b))
  return { ...pinch, scale, recent: [...within(pinch.recent, time), { time, scale }] }
}

// Scale per second over the last `velocityWindowMs` before `time`; negative
// while the fingers close.
export const pinchVelocity = (pinch: Pinch, time: number) => {
  const samples = within(pinch.recent, time)
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (first === undefined || last === undefined || last.time <= first.time) return 0
  return ((last.scale - first.scale) * 1000) / (last.time - first.time)
}

export const pinchCloses = (pinch: Pinch, time: number) =>
  pinch.scale <= pinchCloseScale ||
  (pinch.scale < 1 && pinchVelocity(pinch, time) <= -pinchFlingSpeed)
