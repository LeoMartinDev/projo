import type { TapZone } from './shortcuts.ts'

// Taps on the touch surface of the player (§10.7). A single tap toggles the
// controls, but only once no second tap can follow; two taps on the same side
// seek, and every further tap on that side while they keep coming adds a step.
// A seek never touches the controls.

export type Tap = { time: number; zone: TapZone }

export type SeekSide = 'left' | 'right'

export type TapGesture =
  | { kind: 'idle' }
  | { kind: 'pending'; tap: Tap }
  | { kind: 'seeking'; side: SeekSide; steps: number; tap: Tap }

export type TapStep = {
  gesture: TapGesture
  // A seek of one step towards `side`; `steps` is the total of the series so far.
  seek?: { side: SeekSide; steps: number }
  // When to call `settled` if no other tap comes first.
  settleAfterMs: number
}

export const doubleTapMs = 300
export const seekSeriesMs = 700

export const idleGesture: TapGesture = { kind: 'idle' }

const sideOf = (zone: TapZone): SeekSide | undefined => (zone === 'center' ? undefined : zone)

const seeking = (side: SeekSide, steps: number, tap: Tap): TapStep => ({
  gesture: { kind: 'seeking', side, steps, tap },
  seek: { side, steps },
  settleAfterMs: seekSeriesMs,
})

export const tapped = (gesture: TapGesture, tap: Tap): TapStep => {
  const side = sideOf(tap.zone)
  if (
    side !== undefined &&
    gesture.kind === 'seeking' &&
    tap.time - gesture.tap.time <= seekSeriesMs
  )
    return seeking(side, side === gesture.side ? gesture.steps + 1 : 1, tap)
  if (
    side !== undefined &&
    gesture.kind === 'pending' &&
    gesture.tap.zone === tap.zone &&
    tap.time - gesture.tap.time <= doubleTapMs
  )
    return seeking(side, 1, tap)
  return { gesture: { kind: 'pending', tap }, settleAfterMs: doubleTapMs }
}

// No tap came within `settleAfterMs`: a lone tap toggles the controls, a seek
// series ends.
export const settled = (gesture: TapGesture): { gesture: TapGesture; toggleControls: boolean } => ({
  gesture: idleGesture,
  toggleControls: gesture.kind === 'pending',
})
