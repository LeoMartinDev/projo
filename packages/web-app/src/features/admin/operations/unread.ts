import { queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'

export const notificationsQueryKey = ['admin', 'notifications'] as const

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
