import { useEffect } from 'react'

import { api, request } from '../../shared/api/client.ts'
import { guideRefreshMs } from './queries.ts'

/** The page waits this long after its visible cards change before telling the server. */
const settleMs = 2_000

/** At most this many ids per hint (§29.4). */
const maxIds = 200

/** The cards' attribute naming their channel. */
export const channelAttribute = 'data-channel-id'

/** The ids a hint sends: each once, sorted, at most 200. */
export const hintIdsOf = (visible: Iterable<string>): string[] =>
  [...new Set(visible)].sort().slice(0, maxIds)

/**
 * The TV page's hint (§29.4): the channels whose cards (`data-channel-id`) are in the viewport,
 * sent to the server 2 s after they change and every minute while the page is visible, so that
 * the background snapshot grabs start with what is on screen. A failed hint is dropped.
 */
export const useVisibleChannelsHint = (root: HTMLElement | undefined) => {
  useEffect(() => {
    if (root === undefined || typeof IntersectionObserver === 'undefined') return
    const shown = new Map<Element, string>()
    let sent: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const send = (always: boolean) => {
      if (document.visibilityState !== 'visible') return
      const channelIds = hintIdsOf(shown.values())
      const key = channelIds.join(',')
      if (!always && key === sent) return
      sent = key
      void request(() => api.tv['visible-channels'].$post({ json: { channelIds } })).catch(() => {})
    }
    const changed = () => {
      clearTimeout(timer)
      timer = setTimeout(() => send(false), settleMs)
    }
    const intersections = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute(channelAttribute) ?? undefined
        if (entry.isIntersecting && id !== undefined) shown.set(entry.target, id)
        else shown.delete(entry.target)
      }
      changed()
    })
    const observed = new Set<Element>()
    const observe = () => {
      for (const element of [...observed])
        if (!root.contains(element)) {
          observed.delete(element)
          shown.delete(element)
          intersections.unobserve(element)
        }
      for (const element of root.querySelectorAll(`[${channelAttribute}]`))
        if (!observed.has(element)) {
          observed.add(element)
          intersections.observe(element)
        }
      changed()
    }
    observe()
    const mutations = new MutationObserver(observe)
    mutations.observe(root, { childList: true, subtree: true })
    const every = setInterval(() => send(true), guideRefreshMs)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') send(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      intersections.disconnect()
      mutations.disconnect()
      clearInterval(every)
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [root])
}
