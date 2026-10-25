import { useQueryClient } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'

import type { MeResponse } from '@projo/shared/api/auth'

import { eventHub } from '../shared/events/events.ts'

/** Refetches after the last `catalog.changed` of a burst, never more than once per this delay. */
const catalogRefreshMs = 1500

/**
 * Signed-in area. `catalog.changed` (SSE, every profile: files ready, scans finished,
 * identification and images done) refreshes the catalog queries, so Movies, Shows and the home
 * fill with posters live (§4 parcours 1).
 */
export const AuthedLayout = (_props: { me: MeResponse }) => {
  const queryClient = useQueryClient()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = eventHub.subscribe('catalog.changed', () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void queryClient.invalidateQueries({ queryKey: ['catalog'] })
      }, catalogRefreshMs)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [queryClient])

  return <Outlet />
}
