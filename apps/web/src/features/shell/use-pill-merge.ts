import { useLayoutEffect, useRef } from 'react'

import { media, reducedMotion } from '../../shared/styles/media.ts'
import { useElement } from '../../shared/ui/use-element.ts'
import { type PillLayout, pillMerge, type SideMotion } from './pill-merge.ts'

const stiffness = 380
const damping = 25
const lag = 45
const instant = `${media.compact}, ${reducedMotion}`

const box = (element: HTMLElement) => ({ left: element.offsetLeft, width: element.offsetWidth })

const shift = (layout: PillLayout, x: number, y: number): PillLayout => ({
  logo: { ...layout.logo, left: layout.logo.left - x },
  nav: { ...layout.nav, left: layout.nav.left - x },
  actions: { ...layout.actions, left: layout.actions.left - x },
  top: layout.top - y,
  height: layout.height,
})

const atRest = (target: number): SideMotion => ({ progress: target, velocity: 0, acceleration: 0 })

const advance = (spring: SideMotion, target: number, dt: number): SideMotion => {
  const acceleration = stiffness * (target - spring.progress) - damping * spring.velocity
  const velocity = spring.velocity + acceleration * dt
  const next = { progress: spring.progress + velocity * dt, velocity, acceleration }
  const resting = Math.abs(target - next.progress) < 0.001 && Math.abs(velocity) < 0.01
  return resting ? atRest(target) : next
}

export const usePillMerge = (merged: boolean) => {
  const [header, headerRef] = useElement<HTMLElement>()
  const springs = useRef({ logo: atRest(0), actions: atRest(0) })
  const actionsTarget = useRef(0)

  useLayoutEffect(() => {
    const logo = header?.querySelector<HTMLElement>('.shell__logo')
    const nav = header?.querySelector<HTMLElement>('.pill-nav')
    const actions = header?.querySelector<HTMLElement>('.shell__actions')
    const glass = header?.querySelector<HTMLElement>('.pill-merge__glass')
    const shape = header?.querySelector('#pill-merge-shape')
    const logoBlur = header?.querySelector('#pill-merge-blur-logo feGaussianBlur')
    const actionsBlur = header?.querySelector('#pill-merge-blur-actions feGaussianBlur')
    if (!header || !logo || !nav || !actions || !glass || !shape || !logoBlur || !actionsBlur)
      return

    const blur = (element: HTMLElement, filter: Element, amount: number) => {
      filter.setAttribute('stdDeviation', `${amount} 0`)
      element.style.filter = amount > 0.1 ? `url(#${filter.parentElement?.id})` : ''
    }

    const paint = () => {
      const layout = {
        logo: box(logo),
        nav: box(nav),
        actions: box(actions),
        top: nav.offsetTop,
        height: nav.offsetHeight,
      }
      const merge = pillMerge(layout, springs.current)
      shape.setAttribute('d', merge.path)
      /* WebKit clips a backdrop to the element's rounded box, never to its clip-path: fit the glass to the shape's bounds and round it like the pill. */
      const { left, top, width, height, radius } = merge.bounds
      const local = pillMerge(shift(layout, left, top), springs.current)
      Object.assign(glass.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: `${radius}px`,
        clipPath: `path('${local.path}')`,
      })
      header.style.setProperty('--logo-x', `${merge.logo.x}px`)
      header.style.setProperty('--actions-x', `${merge.actions.x}px`)
      blur(logo, logoBlur, merge.logo.blur)
      blur(actions, actionsBlur, merge.actions.blur)
    }

    const target = merged ? 1 : 0
    const start = performance.now()
    let last = start
    let frame = 0
    /* The frame timestamp can be older than the effect's clock by a whole delayed frame after a scroll: time the spring on the real clock. */
    const step = () => {
      const now = performance.now()
      const dt = Math.min(Math.max(now - last, 0), 32) / 1000
      last = now
      const skip = window.matchMedia(instant).matches
      if (skip || now - start >= lag) actionsTarget.current = target
      springs.current = skip
        ? { logo: atRest(target), actions: atRest(target) }
        : {
            logo: advance(springs.current.logo, target, dt),
            actions: advance(springs.current.actions, actionsTarget.current, dt),
          }
      paint()
      const { logo: logoSpring, actions: actionsSpring } = springs.current
      if (logoSpring.progress !== target || actionsSpring.progress !== target)
        frame = requestAnimationFrame(step)
    }

    paint()
    frame = requestAnimationFrame(step)
    const observer = new ResizeObserver(paint)
    for (const element of [header, logo, nav, actions]) observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [header, merged])

  return headerRef
}
