import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import type { CreateProfileBody, ProfileDto, UpdateProfileBody } from '@projo/shared/api/profiles'

import { api, request } from '../../shared/api/client.ts'
import { profileSelected, profileUpdated, sessionQuery } from '../../shared/session/session.ts'

/** `GET /profiles`: the account's profiles, oldest first (§13.6). */
export const profilesQuery = queryOptions({
  queryKey: ['profiles'],
  queryFn: () => request(() => api.profiles.$get()),
})

/** The profiles changed: the list and the session (`GET /auth/me` carries them too). */
const useRefreshProfiles = () => {
  const queryClient = useQueryClient()
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ['profiles'] })
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
  }
}

/**
 * `POST /profiles/:id/select` (§13.6): the profile becomes the session's, PIN checked by the
 * server. The previous profile's cache is dropped.
 */
export const useSelectProfile = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, pin }: { id: string; pin?: string }) =>
      request(() =>
        api.profiles[':id'].select.$post({ param: { id }, json: pin === undefined ? {} : { pin } }),
      ),
    onSuccess: (me) => profileSelected(queryClient, me),
  })
}

/** `POST /profiles/:id/verify-pin`: unlocks the editor of a protected profile. */
export const useVerifyPin = () =>
  useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      request(() => api.profiles[':id']['verify-pin'].$post({ param: { id }, json: { pin } })),
  })

export const useCreateProfile = () => {
  const refresh = useRefreshProfiles()
  return useMutation({
    mutationFn: (body: CreateProfileBody) => request(() => api.profiles.$post({ json: body })),
    onSuccess: refresh,
  })
}

export const useUpdateProfile = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProfileBody }) =>
      request(() => api.profiles[':id'].$patch({ param: { id }, json: body })),
    onSuccess: async (profile: ProfileDto) => {
      profileUpdated(queryClient, profile)
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

export const useDeleteProfile = () => {
  const refresh = useRefreshProfiles()
  return useMutation({
    mutationFn: ({ id, currentPin }: { id: string; currentPin?: string }) =>
      request(() =>
        api.profiles[':id'].$delete({
          param: { id },
          json: currentPin === undefined ? {} : { currentPin },
        }),
      ),
    onSuccess: refresh,
  })
}
