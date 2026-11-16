import { describe, expect, test } from 'bun:test'

import type { NavIntent } from '../spatial-nav/keys.ts'
import {
  initialPadState,
  type PadSnapshot,
  type PadState,
  readPads,
  repeatDelayMs,
  repeatIntervalMs,
  resumePads,
  stickDirection,
} from './gamepad.ts'

const pad = (
  pressed: readonly number[] = [],
  axes: readonly number[] = [0, 0, 0, 0],
  extra: Partial<PadSnapshot> = {},
): PadSnapshot => ({
  index: 0,
  standard: true,
  pressed: Array.from({ length: 17 }, (_, button) => pressed.includes(button)),
  axes,
  ...extra,
})

// Reads a sequence of frames `[time, pads]`, collecting the intents of each.
const play = (frames: readonly (readonly [number, readonly PadSnapshot[]])[]) => {
  let state: PadState = initialPadState
  const sent: { at: number; intents: readonly NavIntent[] }[] = []
  for (const [at, pads] of frames) {
    const read = readPads(state, pads, at)
    state = read.state
    sent.push({ at, intents: read.intents })
  }
  return { state, sent, all: sent.flatMap(({ intents }) => intents) }
}

const move = (direction: 'up' | 'down' | 'left' | 'right'): NavIntent => ({
  kind: 'move',
  direction,
})

// One frame every 16 ms from `from` to `to`, holding `pads`.
const hold = (from: number, to: number, pads: readonly PadSnapshot[]) =>
  Array.from(
    { length: Math.floor((to - from) / 16) + 1 },
    (_, frame) => [from + frame * 16, pads] as const,
  )

describe('readPads: the standard mapping', () => {
  test('each button sends its intent once, when pressed', () => {
    const cases: readonly (readonly [number, NavIntent])[] = [
      [0, { kind: 'activate' }],
      [1, { kind: 'back' }],
      [8, { kind: 'back' }],
      [2, { kind: 'media', action: 'toggle_play' }],
      [9, { kind: 'media', action: 'toggle_play' }],
      [4, { kind: 'media', action: 'seek_back' }],
      [5, { kind: 'media', action: 'seek_forward' }],
      [3, { kind: 'menu' }],
      [12, move('up')],
      [13, move('down')],
      [14, move('left')],
      [15, move('right')],
    ]
    for (const [button, intent] of cases) {
      const { sent } = play([
        [0, [pad()]],
        [16, [pad([button])]],
        [32, [pad([button])]],
        [48, [pad()]],
      ])
      expect(sent.map(({ intents }) => intents)).toEqual([[], [intent], [], []])
    }
  })

  test('a button held for long sends nothing more; pressed again, it sends again', () => {
    const { all } = play([...hold(0, 2000, [pad([0])]), [2016, [pad()]], [2032, [pad([0])]]])
    expect(all).toEqual([{ kind: 'activate' }, { kind: 'activate' }])
  })

  test('the guide button and the triggers send nothing', () => {
    expect(play([[0, [pad([6, 7, 10, 11, 16])]]]).all).toEqual([])
  })

  test('a button held when reading starts counts as pressed', () => {
    expect(play([[0, [pad([0])]]]).all).toEqual([{ kind: 'activate' }])
  })
})

describe('readPads: directions repeat while held', () => {
  test('at once, then after the delay, then at each interval', () => {
    const { sent } = play(hold(0, 1000, [pad([13])]))
    const times = sent.filter(({ intents }) => intents.length > 0).map(({ at }) => at)
    expect(times[0]).toBe(0)
    expect(times[1]).toBeGreaterThanOrEqual(repeatDelayMs)
    expect(times[1]).toBeLessThan(repeatDelayMs + 16)
    for (let index = 2; index < times.length; index += 1)
      expect((times[index] ?? 0) - (times[index - 1] ?? 0)).toBeGreaterThanOrEqual(repeatIntervalMs)
    expect(times.length).toBe(1 + 1 + Math.floor((1000 - repeatDelayMs) / (repeatIntervalMs + 8)))
    expect(sent.flatMap(({ intents }) => intents).every((intent) => intent.kind === 'move')).toBe(
      true,
    )
  })

  test('released before the delay: one move only', () => {
    const { all } = play([...hold(0, 380, [pad([15])]), [400, [pad()]], [800, [pad()]]])
    expect(all).toEqual([move('right')])
  })

  test('a frame missed for long sends one repeat, not a burst', () => {
    const { sent } = play([
      [0, [pad([13])]],
      [5000, [pad([13])]],
      [5016, [pad([13])]],
    ])
    expect(sent.map(({ intents }) => intents.length)).toEqual([1, 1, 0])
  })

  test('the last direction pressed repeats; the first one held does not', () => {
    const { sent } = play([
      [0, [pad([13])]],
      [200, [pad([13, 15])]],
      ...hold(216, 1000, [pad([13, 15])]),
    ])
    const after = sent.filter(({ at }) => at > 200).flatMap(({ intents }) => intents)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((intent) => intent.kind === 'move' && intent.direction === 'right')).toBe(
      true,
    )
  })

  test('the newer direction released: nothing repeats, even with the other still held', () => {
    const { sent } = play([
      [0, [pad([13])]],
      [100, [pad([13, 15])]],
      [200, [pad([13])]],
      ...hold(216, 1500, [pad([13])]),
    ])
    expect(sent.filter(({ at }) => at >= 200).flatMap(({ intents }) => intents)).toEqual([])
  })

  test('the delay starts again with each new press', () => {
    const { sent } = play([
      [0, [pad([13])]],
      [300, [pad()]],
      [350, [pad([13])]],
      [700, [pad([13])]],
      [760, [pad([13])]],
    ])
    expect(sent.map(({ intents }) => intents.length)).toEqual([1, 0, 1, 0, 1])
  })
})

describe('stickDirection', () => {
  test('a dead zone, then the dominant axis', () => {
    expect(stickDirection(undefined, 0.3, -0.4)).toBeUndefined()
    expect(stickDirection(undefined, 0.6, 0.2)).toBe('right')
    expect(stickDirection(undefined, -0.6, 0.2)).toBe('left')
    expect(stickDirection(undefined, 0.2, 0.7)).toBe('down')
    expect(stickDirection(undefined, 0.2, -0.7)).toBe('up')
  })

  test('hysteresis: kept down to the release threshold', () => {
    expect(stickDirection(undefined, 0.45, 0)).toBeUndefined()
    expect(stickDirection('right', 0.45, 0)).toBe('right')
    expect(stickDirection('right', 0.36, 0)).toBe('right')
    expect(stickDirection('right', 0.3, 0)).toBeUndefined()
  })

  test('a diagonal keeps the direction it had; another takes over when it clearly leads', () => {
    expect(stickDirection('right', 0.7, 0.72)).toBe('right')
    expect(stickDirection('down', 0.72, 0.7)).toBe('down')
    expect(stickDirection('right', 0.4, 0.9)).toBe('down')
  })

  test('noise from a missing or broken axis is no direction', () => {
    expect(stickDirection(undefined, Number.NaN, 0)).toBeUndefined()
  })
})

describe('readPads: the stick', () => {
  test('pushed past the dead zone moves once, then repeats like the d-pad', () => {
    const { sent } = play([[0, [pad([], [0.2, 0])]], ...hold(16, 600, [pad([], [0.9, 0.1])])])
    const moves = sent.flatMap(({ intents }) => intents)
    expect(moves[0]).toEqual(move('right'))
    expect(moves.length).toBeGreaterThan(1)
  })

  test('wobbling around the threshold sends one move', () => {
    const { all } = play([
      [0, [pad([], [0, 0.55])]],
      [16, [pad([], [0, 0.45])]],
      [32, [pad([], [0, 0.52])]],
      [48, [pad([], [0, 0.4])]],
      [64, [pad([], [0, 0.1])]],
    ])
    expect(all).toEqual([move('down')])
  })

  test('the d-pad and the stick the same way are one direction', () => {
    const { all } = play([
      [0, [pad([13])]],
      [16, [pad([13], [0, 0.9])]],
      [32, [pad([], [0, 0.9])]],
      [48, [pad()]],
    ])
    expect(all).toEqual([move('down')])
  })
})

describe('readPads: several pads', () => {
  test('they act as one: a button held on one and pressed on the other sends nothing more', () => {
    const second = { index: 1 }
    const { sent } = play([
      [0, [pad([0]), pad([], undefined, second)]],
      [16, [pad([0]), pad([0], undefined, second)]],
      [32, [pad(), pad([0], undefined, second)]],
      [48, [pad(), pad([], undefined, second)]],
      [64, [pad([1]), pad([], undefined, second)]],
    ])
    expect(sent.map(({ intents }) => intents)).toEqual([
      [{ kind: 'activate' }],
      [],
      [],
      [],
      [{ kind: 'back' }],
    ])
  })

  test('each pad has its own stick', () => {
    const second = { index: 1 }
    const { all } = play([
      [0, [pad([], [0.9, 0]), pad([], [0, 0], second)]],
      [16, [pad([], [0.9, 0]), pad([], [0, -0.9], second)]],
    ])
    expect(all).toEqual([move('right'), move('up')])
  })

  test('a pad unplugged mid-hold: no intent, the repeat stops, plugged again it is a new press', () => {
    const { sent } = play([
      [0, [pad([13])]],
      [100, []],
      ...hold(116, 1000, []),
      [1016, [pad([13])]],
    ])
    expect(sent.map(({ intents }) => intents.length).filter((count) => count > 0)).toEqual([1, 1])
    expect(sent.at(-1)?.intents).toEqual([move('down')])
  })

  test('a pad unplugged mid-hold while another holds the same direction keeps repeating', () => {
    const second = { index: 1 }
    const { sent } = play([
      [0, [pad([13]), pad([13], undefined, second)]],
      ...hold(16, 600, [pad([13], undefined, second)]),
    ])
    expect(
      sent.filter(({ at }) => at > 0).flatMap(({ intents }) => intents).length,
    ).toBeGreaterThan(0)
  })
})

describe('readPads: a pad without the standard mapping', () => {
  test('button 0 activates, 1 goes back, the left stick moves; the other buttons do nothing', () => {
    const other = { standard: false }
    const { all } = play([
      [0, [pad([0], undefined, other)]],
      [16, [pad([1], undefined, other)]],
      [32, [pad([2, 3, 4, 5, 8, 9, 12, 13, 14, 15], undefined, other)]],
      [48, [pad([], [0, 0.9], other)]],
    ])
    expect(all).toEqual([{ kind: 'activate' }, { kind: 'back' }, move('down')])
  })
})

describe('resumePads', () => {
  test('a direction held through a pause waits the full delay again; nothing is pressed anew', () => {
    const before = play([[0, [pad([13])]], ...hold(16, 600, [pad([13])])]).state
    const resumed = resumePads(before, 10_000)
    const first = readPads(resumed, [pad([13])], 10_000)
    expect(first.intents).toEqual([])
    expect(readPads(first.state, [pad([13])], 10_000 + repeatDelayMs - 20).intents).toEqual([])
    expect(readPads(first.state, [pad([13])], 10_000 + repeatDelayMs).intents).toEqual([
      move('down'),
    ])
  })

  test('nothing repeating: the state is kept as is', () => {
    expect(resumePads(initialPadState, 5)).toEqual(initialPadState)
  })
})
