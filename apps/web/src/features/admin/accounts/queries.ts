import { queryOptions } from '@tanstack/react-query'

import { api, request } from '../../../shared/api/client.ts'

export const accountsQueryKey = ['admin', 'accounts'] as const

export const accountsQuery = queryOptions({
  queryKey: accountsQueryKey,
  queryFn: () => request(() => api.admin.accounts.$get()),
})

export const invitationsQueryKey = ['admin', 'invitations'] as const

export const invitationsQuery = queryOptions({
  queryKey: invitationsQueryKey,
  queryFn: () => request(() => api.admin.invitations.$get()),
})

export const invitationLink = (token: string, origin: string = window.location.origin): string =>
  `${origin}/invite/${encodeURIComponent(token)}`
