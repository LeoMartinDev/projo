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

/** The session's client, or a failure if the server is gone meanwhile. */
const useApi = () => {
  const session = useSession()
  const api = () => {
    if (session.api === undefined) throw failure('unknown', 'no server')
    return session.api
  }
  return { session, api }
}

/** `POST /profiles` (§13.6): up to five; the session's profiles follow. */
export const useCreateProfile = () => {
  const { session, api } = useApi()
  return useMutation({
    mutationFn: (body: CreateProfileBody) =>
      unwrap(requestApi(() => api().profiles.$post({ json: body }), profileDtoSchema)),
    onSuccess: session.refreshMe,
  })
}

/** `PATCH /profiles/:id`: name, colour, PIN, settings (§11.1, §12.4). */
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

/** `DELETE /profiles/:id`: its progress is lost (§13.6). */
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

/** `POST /profiles/:id/verify-pin`: unlocks the editor of another protected profile (§14). */
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
