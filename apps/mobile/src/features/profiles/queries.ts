import { useMutation } from '@tanstack/react-query'

import {
  type CreateProfileBody,
  profileDtoSchema,
  type UpdateProfileBody,
} from '@projo/shared/api/profiles'

import { failure } from '../../shared/api/failure.ts'
import { requestApi } from '../../shared/api/client.ts'
import { unwrap } from '../server-connection/ServerConnection.tsx'
import { useSession } from '../session/Session.tsx'

const useApi = () => {
  const session = useSession()
  const api = () => {
    if (session.api === undefined) throw failure('unknown', 'no server')
    return session.api
  }
  return { session, api }
}

export const useCreateProfile = () => {
  const { session, api } = useApi()
  return useMutation({
    mutationFn: (body: CreateProfileBody) =>
      unwrap(requestApi(() => api().profiles.$post({ json: body }), profileDtoSchema)),
    onSuccess: session.refreshMe,
  })
}

export const useUpdateProfile = () => {
  const { session, api } = useApi()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProfileBody }) =>
      unwrap(
        requestApi(
          () => api().profiles[':id'].$patch({ param: { id }, json: body }),
          profileDtoSchema,
        ),
      ),
    onSuccess: session.profileSaved,
  })
}

export const useDeleteProfile = () => {
  const { session, api } = useApi()
  return useMutation({
    mutationFn: ({ id, currentPin }: { id: string; currentPin?: string }) =>
      unwrap(
        requestApi(() =>
          api().profiles[':id'].$delete({
            param: { id },
            json: currentPin === undefined ? {} : { currentPin },
          }),
        ),
      ),
    onSuccess: session.refreshMe,
  })
}

export const useVerifyPin = () => {
  const { api } = useApi()
  return useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      unwrap(
        requestApi(() =>
          api().profiles[':id']['verify-pin'].$post({ param: { id }, json: { pin } }),
        ),
      ),
  })
}
