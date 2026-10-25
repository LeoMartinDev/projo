import { queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'

/** Shared with the shell (avatar menu): kept apart from the admin chunks. */
export const notificationsQueryKey = ['admin', 'notifications'] as const

/** The menu badge (§15): unread notifications, all pages. */
export const unreadNotificationsQuery = queryOptions({
  queryKey: [...notificationsQueryKey, 'unread'],
  queryFn: async () => {
    const page = await request(() =>
      api.admin.notifications.$get({ query: { status: 'unread', limit: '1' } }),
    )
    return page.unreadCount
  },
  staleTime: 30_000,
})
