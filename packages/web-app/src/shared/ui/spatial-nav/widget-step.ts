import { type Direction, isHorizontal } from './geometry.ts'

// A "move" intent with no key (a gamepad) inside a widget that moves with the
// arrow keys by itself (spatial-nav.ts), the pure part: where it steps, and
// whether reaching an item chooses it.

export type WidgetKind = 'tab' | 'radio' | 'option' | 'radio_input'

/**
 * Whether reaching an item chooses it: a radio input only, as its arrow keys
 * do. A tab waits for "activate" (passing over season tabs must not load each
 * season), a menu's radio or a select's option too.
 */
export const choosesOnStep = (kind: WidgetKind) => kind === 'radio_input'

/**
 * The index a move steps to from `index` among `count` items that run across
 * (or down): the next or previous one along that axis; undefined at an end or
 * across it, where focus leaves the widget.
 */
export const widgetStepIndex = ({
  index,
  count,
  across,
  direction,
}: {
  index: number
  count: number
  across: boolean
  direction: Direction
}): number | undefined => {
  if (index < 0 || across !== isHorizontal(direction)) return undefined
  const next = index + (direction === 'right' || direction === 'down' ? 1 : -1)
  return next >= 0 && next < count ? next : undefined
}
