import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import type { CreateAssistantTokenBody } from '@projo/shared/api/assistants'
import type { UpdateAdminSettingsBody } from '@projo/shared/api/settings'

import { api, request } from '../../../shared/api/client.ts'

export const settingsQueryKey = ['admin', 'settings'] as const

/** `GET /admin/settings` (§15 "Metadata"): language and whether a TMDB key is set. */
export const settingsQuery = queryOptions({
  queryKey: settingsQueryKey,
  queryFn: () => request(() => api.admin.settings.$get()),
})

export const assistantTokensQueryKey = ['admin', 'assistant-tokens'] as const

/** `GET /admin/assistant-tokens` (§27.3): the signed-in admin's assistant tokens. */
export const assistantTokensQuery = queryOptions({
  queryKey: assistantTokensQueryKey,
  queryFn: () => request(() => api.admin['assistant-tokens'].$get()),
})

/** `POST /admin/assistant-tokens`: the answer carries the token, shown once. */
export const useCreateAssistantToken = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAssistantTokenBody) =>
      request(() => api.admin['assistant-tokens'].$post({ json: body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistantTokensQueryKey }),
  })
}

/** `DELETE /admin/assistant-tokens/:id`: the assistant loses access at its next request. */
export const useRevokeAssistantToken = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request(() => api.admin['assistant-tokens'][':id'].$delete({ param: { id } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: assistantTokensQueryKey }),
  })
}

/** Where a TMDB API key is created (§9.1, linked from the settings and the banner). */
export const tmdbKeyPageUrl = 'https://www.themoviedb.org/settings/api'

/** `PATCH /admin/settings`, section by section; the answer replaces the cached settings. */
export const useUpdateSettings = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateAdminSettingsBody) =>
      request(() => api.admin.settings.$patch({ json: body })),
    onSuccess: (settings, body) => {
      queryClient.setQueryData(settingsQueryKey, settings)
      // A new TMDB key relaunches the matching of the unidentified sources (§9.1).
      if (body.metadata?.tmdbApiKey !== undefined)
        void queryClient.invalidateQueries({ queryKey: ['admin', 'review'] })
    },
  })
}
