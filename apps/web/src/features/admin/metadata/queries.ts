import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { profileIdHeader } from '@projo/shared/api/auth'
import type {
  ChooseItemImageBody,
  EditableField,
  EditableImageKind,
  ItemMetadataDto,
  UpdateItemMetadataBody,
} from '@projo/shared/api/metadata'

import { api, apiPrefix, request } from '../../../shared/api/client.ts'
import { failureFromResponse, networkFailure } from '../../../shared/api/failure.ts'
import { getActiveProfileId } from '../../../shared/session/active-profile.ts'
import { invalidateAfterIdentify } from '../identify/queries.ts'

export const itemMetadataQueryKey = (itemId: string) => ['admin', 'item-metadata', itemId] as const

export const itemMetadataQuery = (itemId: string) =>
  queryOptions({
    queryKey: itemMetadataQueryKey(itemId),
    queryFn: () => request(() => api.admin.items[':id'].$get({ param: { id: itemId } })),
  })

export const imageAlternativesQuery = (itemId: string, kind: EditableImageKind) =>
  queryOptions({
    queryKey: ['admin', 'item-metadata', itemId, 'alternatives', kind] as const,
    queryFn: () =>
      request(() =>
        api.admin.items[':id'].images.alternatives.$get({
          param: { id: itemId },
          query: { kind },
        }),
      ),
    staleTime: 5 * 60_000,
    retry: false,
  })

const applyEdit = async (queryClient: QueryClient, item: ItemMetadataDto) => {
  queryClient.setQueryData(itemMetadataQueryKey(item.id), item)
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...itemMetadataQueryKey(item.id), 'alternatives'],
    }),
    invalidateAfterIdentify(queryClient),
  ])
}

export const useUpdateItemMetadata = (itemId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (json: UpdateItemMetadataBody) =>
      request(() => api.admin.items[':id'].$patch({ param: { id: itemId }, json })),
    onSuccess: (item) => applyEdit(queryClient, item),
  })
}

export const useRemoveOverride = (itemId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (field: EditableField) =>
      request(() =>
        api.admin.items[':id'].overrides[':field'].$delete({ param: { id: itemId, field } }),
      ),
    onSuccess: (item) => applyEdit(queryClient, item),
  })
}

const postImage = async (itemId: string, body: ChooseItemImageBody | FormData) => {
  const profileId = getActiveProfileId()
  const profileHeaders = profileId === undefined ? {} : { [profileIdHeader]: profileId }
  const response = await fetch(`${apiPrefix}/admin/items/${encodeURIComponent(itemId)}/images`, {
    method: 'POST',
    credentials: 'same-origin',
    ...(body instanceof FormData
      ? { body, headers: profileHeaders }
      : {
          body: JSON.stringify(body),
          headers: { ...profileHeaders, 'content-type': 'application/json' },
        }),
  }).catch((cause: unknown): never => {
    throw networkFailure(cause)
  })
  if (!response.ok) throw await failureFromResponse(response)
  return (await response.json()) as ItemMetadataDto
}

export const useChooseImage = (itemId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ChooseItemImageBody) => postImage(itemId, body),
    onSuccess: (item) => applyEdit(queryClient, item),
  })
}

export const useUploadImage = (itemId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, file }: { kind: EditableImageKind; file: File }) => {
      const form = new FormData()
      form.set('kind', kind)
      form.set('file', file)
      return postImage(itemId, form)
    },
    onSuccess: (item) => applyEdit(queryClient, item),
  })
}

export const useRefreshItem = () =>
  useMutation({
    mutationFn: (itemId: string) =>
      request(() => api.admin.items[':id'].refresh.$post({ param: { id: itemId } })),
  })

export const useOptimizeImages = () =>
  useMutation({ mutationFn: () => request(() => api.admin.images.optimize.$post()) })

export const useRefreshLibrary = () =>
  useMutation({
    mutationFn: (libraryId: string) =>
      request(() =>
        api.admin.libraries[':id']['refresh-metadata'].$post({ param: { id: libraryId } }),
      ),
  })
