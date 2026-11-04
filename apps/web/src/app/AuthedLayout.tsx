import { useQueryClient } from '@tanstack/react-query'
import { Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'

import type { MeResponse } from '@projo/shared/api/auth'

import { refreshLive } from '../shared/api/live-refresh.ts'
import { eventHub } from '../shared/events/events.ts'

const catalogRefreshMs = 1500

export const AuthedLayout = (_props: { me: MeResponse }) => {
  const queryClient = useQueryClient()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = eventHub.subscribe('catalog.changed', () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        refreshLive(queryClient, ['catalog'])
      }, catalogRefreshMs)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [queryClient])

  return <Outlet />
}
