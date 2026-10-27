/** Where the header's pieces sit, in px from the header's edge, before the merge moves them. */
export type PillLayout = {
  logo: { left: number; width: number }
  nav: { left: number; width: number }
  actions: { left: number; width: number }
  top: number
  height: number
}

/** A side's spring: 0 = apart, 1 = merged (it overshoots both), its speed and pull per second. */
export type SideMotion = { progress: number; velocity: number; acceleration: number }

// Room around the wordmark and the actions inside their bubbles: [left, right].
const logoPadding = [22, 14] as const
const actionsPadding = [6, 7] as const
// Gap under which two bubbles reach for each other.
const bridgeReach = 32
// Liquid deformation: stretched by speed, squashed while braking (the impact).
const stretchPerSpeed = 0.02
const squashPerBraking = 0.0022

const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x))
const easeOut = (x: number) => 1 - (1 - x) ** 3
const px = (x: number) => Math.round(x * 100) / 100

/** > 0 stretched along the glide, < 0 squashed; 0 at rest. */
const deformation = ({ velocity, acceleration }: SideMotion) => {
  // Pulled against its motion; a smooth sign, so it does not jump as the motion turns back.
  const braking = Math.max(0, (-acceleration * velocity) / (Math.abs(velocity) + 0.5))
  return clamp(stretchPerSpeed * Math.abs(velocity) - squashPerBraking * braking, -0.15, 0.25)
}

/** A pill from `left` to `right` around the line `cy`, drawn clockwise (the subpaths add up). */
const stadium = (left: number, right: number, cy: number, r: number) =>
  `M${px(left + r)} ${px(cy - r)}H${px(right - r)}A${px(r)} ${px(r)} 0 0 1 ${px(right - r)} ${px(cy + r)}` +
  `H${px(left + r)}A${px(r)} ${px(r)} 0 0 1 ${px(left + r)} ${px(cy - r)}Z`

/**
 * The liquid neck between the facing ends of two pills (circles of radius `r1` centred on `a`,
 * `r2` on `b`): it leaves each circle along its tangent, pinched at first (`reach` 0), straight
 * once they touch (1).
 */
const bridge = (a: number, r1: number, b: number, r2: number, cy: number, reach: number) => {
  const angle = (1 - reach) * 1.35
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const r = Math.min(r1, r2)
  const x1 = a + r1 * sin
  const x2 = b - r2 * sin
  const waist = r * reach * reach
  const handle = sin === 0 ? 0 : Math.min((r * cos - waist) / (0.75 * sin), (x2 - x1) / 2 / cos)
  const hx = handle * cos
  const hy = handle * sin
  const [top1, top2] = [cy - r1 * cos, cy - r2 * cos]
  const [bottom1, bottom2] = [cy + r1 * cos, cy + r2 * cos]
  return (
    `M${px(x1)} ${px(top1)}C${px(x1 + hx)} ${px(top1 + hy)} ${px(x2 - hx)} ${px(top2 + hy)} ${px(x2)} ${px(top2)}` +
    `L${px(x2)} ${px(bottom2)}C${px(x2 - hx)} ${px(bottom2 - hy)} ${px(x1 + hx)} ${px(bottom1 - hy)} ${px(x1)} ${px(bottom1)}Z`
  )
}

/**
 * The header as each side's spring has it: a bubble swells behind the wordmark and the actions
 * while they glide to the navigation pill, stretching with speed and squashing as they brake,
 * then each fuses with it like two drops. Returns the outline (SVG path, nonzero) and, per
 * side, how far it moves and its motion blur (px).
 */
export const pillMerge = (
  layout: PillLayout,
  motion: { logo: SideMotion; actions: SideMotion },
) => {
  const { logo, nav, actions, top, height } = layout
  const r = height / 2
  const cy = top + r
  const navRight = nav.left + nav.width

  const side = (state: SideMotion, left: number, right: number, travel: number) => {
    const x = travel * state.progress
    const swell = easeOut(clamp(state.progress / 0.35, 0, 1))
    const shape = deformation(state)
    const middle = (left + right) / 2 + x
    const half = ((right - left) / 2) * (1 + shape) * swell
    return {
      x,
      blur: Math.min(2.5, Math.abs(state.velocity * travel) / 700),
      swell,
      left: middle - half,
      right: middle + half,
      r: r * (1 - 0.4 * shape) * swell,
    }
  }
  const left = side(
    motion.logo,
    logo.left - logoPadding[0],
    logo.left + logo.width + logoPadding[1],
    nav.left - logoPadding[1] - logo.left - logo.width,
  )
  const right = side(
    motion.actions,
    actions.left - actionsPadding[0],
    actions.left + actions.width + actionsPadding[1],
    navRight + actionsPadding[0] - actions.left,
  )

  const parts = [stadium(nav.left, navRight, cy, r)]
  for (const bubble of [left, right])
    if (bubble.swell > 0) parts.push(stadium(bubble.left, bubble.right, cy, bubble.r))
  const leftReach = clamp(1 - (nav.left - left.right) / bridgeReach, 0, 1)
  const [a, b] = [left.right - left.r, nav.left + r]
  if (left.swell === 1 && leftReach > 0 && a < b) parts.push(bridge(a, left.r, b, r, cy, leftReach))
  const rightReach = clamp(1 - (right.left - navRight) / bridgeReach, 0, 1)
  const [c, d] = [navRight - r, right.left + right.r]
  if (right.swell === 1 && rightReach > 0 && c < d)
    parts.push(bridge(c, r, d, right.r, cy, rightReach))

  return {
    path: parts.join(''),
    logo: { x: left.x, blur: left.blur },
    actions: { x: right.x, blur: right.blur },
  }
}
