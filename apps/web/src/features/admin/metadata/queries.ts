import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import type {
  ChooseItemImageBody,
  EditableField,
  EditableImageKind,
  ItemMetadataDto,
  UpdateItemMetadataBody,
} from '@projo/shared/api/metadata'

import { api, apiPrefix, request } from '../../../shared/api/client.ts'
import { failureFromResponse, networkFailure } from '../../../shared/api/failure.ts'
import { invalidateAfterIdentify } from '../identify/queries.ts'

/** `GET /admin/items/:id` (§9.3): values and locks of the editor. */
export const itemMetadataQueryKey = (itemId: string) => ['admin', 'item-metadata', itemId] as const

export const itemMetadataQuery = (itemId: string) =>
  queryOptions({
    queryKey: itemMetadataQueryKey(itemId),
    queryFn: () => request(() => api.admin.items[':id'].$get({ param: { id: itemId } })),
  })

/** `GET /admin/items/:id/images/alternatives?kind=` (TMDB, through the server). */
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

/**
 * The editor's answer replaces its query; the alternatives (their `current` flag) and every viewer
 * query (titles, posters) are refetched.
 */
const applyEdit = async (queryClient: QueryClient, item: ItemMetadataDto) => {
  queryClient.setQueryData(itemMetadataQueryKey(item.id), item)
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...itemMetadataQueryKey(item.id), 'alternatives'],
    }),
    invalidateAfterIdentify(queryClient),
  ])
}

/** `PATCH /admin/items/:id`: the fields given are stored and locked. */
export const useUpdateItemMetadata = (itemId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (json: UpdateItemMetadataBody) =>
      request(() => api.admin.items[':id'].$patch({ param: { id: itemId }, json })),
    onSuccess: (item) => applyEdit(queryClient, item),
  })
}

/** `DELETE /admin/items/:id/overrides/:field` ("Back to the TMDB value"). */
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

/**
 * `POST /admin/items/:id/images`: JSON (a TMDB alternative) or multipart (an upload). The route
 * reads its body itself, outside the RPC types.
 */
const postImage = async (itemId: string, body: ChooseItemImageBody | FormData) => {
  const response = await fetch(`${apiPrefix}/admin/items/${encodeURIComponent(itemId)}/images`, {
    method: 'POST',
    credentials: 'same-origin',
    ...(body instanceof FormData
      ? { body }
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  }).catch((cause: unknown): never => {
    throw networkFailure(cause)
  })
  if (!response.ok) throw await failureFromResponse(response)
  return (await response.json()) as ItemMetadataDto
}

/** A TMDB alternative. */
export const useChooseImage = (itemId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ChooseItemImageBody) => postImage(itemId, body),
    onSuccess: (item) => applyEdit(queryClient, item),
  })
}

/** An upload (JPEG, PNG or WebP, 10 MB; re-encoded by the server). */
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

/** `POST /admin/items/:id/refresh` (§9.4 "Refresh"): a job; the page follows `catalog.changed`. */
export const useRefreshItem = () =>
  useMutation({
    mutationFn: (itemId: string) =>
      request(() => api.admin.items[':id'].refresh.$post({ param: { id: itemId } })),
  })

/** `POST /admin/images/optimize` ("Optimize the images", §9.1): one `image_variants` job. */
export const useOptimizeImages = () =>
  useMutation({ mutationFn: () => request(() => api.admin.images.optimize.$post()) })

/** `POST /admin/libraries/:id/refresh-metadata` ("Refresh the whole library"). */
export const useRefreshLibrary = () =>
  useMutation({
    mutationFn: (libraryId: string) =>
      request(() =>
        api.admin.libraries[':id']['refresh-metadata'].$post({ param: { id: libraryId } }),
      ),
  })
