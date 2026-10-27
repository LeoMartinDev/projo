import { describe, expect, test } from 'bun:test'

import { pillMerge } from './pill-merge.ts'

// A 1280 px header: the wordmark on the left, the navigation centred, the actions on the right.
const layout = {
  logo: { left: 56, width: 66 },
  nav: { left: 470, width: 340 },
  actions: { left: 1128, width: 96 },
  top: 17,
  height: 46,
}

const still = (progress: number) => ({ progress, velocity: 0, acceleration: 0 })
const both = (progress: number) => ({ logo: still(progress), actions: still(progress) })
const subpaths = (path: string) => path.split('M').length - 1

/** Width and height of the wordmark's bubble, the second subpath (`M x y H x A r …`). */
const logoBubble = (path: string) => {
  const match = /^([\d.]+) [\d.]+H([\d.]+)A([\d.]+)/.exec(path.split('M')[2] ?? '')
  if (!match) throw new Error(`no bubble in ${path}`)
  const [x0, x1, r] = match.slice(1).map(Number) as [number, number, number]
  return { width: x1 - x0 + 2 * r, height: 2 * r }
}

describe('pillMerge', () => {
  test('draws the navigation alone before the page scrolls', () => {
    const merge = pillMerge(layout, both(0))
    expect(merge.path).toBe('M493 17H787A23 23 0 0 1 787 63H493A23 23 0 0 1 493 17Z')
    expect([merge.logo.x, merge.actions.x, merge.logo.blur].map(Math.abs)).toEqual([0, 0, 0])
  })

  test('brings the wordmark and the actions flush against the navigation', () => {
    const { logo, actions } = pillMerge(layout, both(1))
    expect(56 + 66 + 14 + logo.x).toBe(470)
    expect(1128 - 6 + actions.x).toBe(810)
  })

  test('fuses the three into one flat pill: both necks run straight along its edges', () => {
    const { path } = pillMerge(layout, both(1))
    expect(subpaths(path)).toBe(5)
    expect(path).toContain('M447 17C447 17 493 17 493 17L493 63')
    expect(path).toContain('M787 17C787 17 833 17 833 17L833 63')
  })

  test('swells the bubbles before they reach each other', () => {
    expect(subpaths(pillMerge(layout, both(0.2)).path)).toBe(3)
  })

  test('stretches a bubble with speed and squashes it as it brakes', () => {
    const resting = logoBubble(pillMerge(layout, both(0.5)).path)
    const gliding = { progress: 0.5, velocity: 9, acceleration: 0 }
    const braking = { progress: 0.5, velocity: 4, acceleration: -90 }
    const stretched = logoBubble(pillMerge(layout, { ...both(0.5), logo: gliding }).path)
    const squashed = logoBubble(pillMerge(layout, { ...both(0.5), logo: braking }).path)
    expect(stretched.width).toBeGreaterThan(resting.width)
    expect(stretched.height).toBeLessThan(resting.height)
    expect(squashed.width).toBeLessThan(resting.width)
    expect(squashed.height).toBeGreaterThan(resting.height)
  })

  test('blurs a side along its glide, never past 2.5 px', () => {
    const merge = pillMerge(layout, { ...both(0.5), actions: { ...still(0.5), velocity: 9 } })
    expect(merge.logo.blur).toBe(0)
    expect(merge.actions.blur).toBe(2.5)
  })
})
