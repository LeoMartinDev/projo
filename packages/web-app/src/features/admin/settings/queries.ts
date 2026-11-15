import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import type { CreateAssistantTokenBody } from '@projo/shared/api/assistants'
import type { UpdateAdminSettingsBody } from '@projo/shared/api/settings'

import { api, request } from '../../../shared/api/client.ts'

export const settingsQueryKey = ['admin', 'settings'] as const

export const settingsQuery = queryOptions({
  queryKey: settingsQueryKey,
  queryFn: () => request(() => api.admin.settings.$get()),
})

export const assistantTokensQueryKey = ['admin', 'assistant-tokens'] as const

export const assistantTokensQuery = queryOptions({
  queryKey: assistantTokensQueryKey,
  queryFn: () => request(() => api.admin['assistant-tokens'].$get()),
})

export const useCreateAssistantToken = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAssistantTokenBody) =>
      request(() => api.admin['assistant-tokens'].$post({ json: body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantTokensQueryKey }),
  })
}

export const useRevokeAssistantToken = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request(() => api.admin['assistant-tokens'][':id'].$delete({ param: { id } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: assistantTokensQueryKey }),
  })
}

export const tmdbKeyPageUrl = 'https://www.themoviedb.org/settings/api'

export const useUpdateSettings = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAdminSettingsBody) =>
      request(() => api.admin.settings.$patch({ json: body })),
    onSuccess: (settings, body) => {
      queryClient.setQueryData(settingsQueryKey, settings)
      if (body.metadata?.tmdbApiKey !== undefined)
        void queryClient.invalidateQueries({ queryKey: ['admin', 'review'] })
    },
  })
}
