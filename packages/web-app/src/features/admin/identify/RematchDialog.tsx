import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AssignBody } from '@projo/shared/api/metadata'

import { api, request } from '../../../shared/api/client.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { EmptyState } from '../../../shared/ui/states.tsx'
import {
  IdentifyForm,
  type IdentifyInitial,
  type IdentifyMode,
  IdentifySubmit,
} from './IdentifyForm.tsx'
import { type IdentifyItem, identifyItemQuery, invalidateAfterIdentify } from './queries.ts'

type RematchKind = 'movie' | 'series' | 'episode'

const modesOf: Record<RematchKind, readonly IdentifyMode[]> = {
  movie: ['movie', 'episode'],
  episode: ['episode', 'movie'],
  series: ['series'],
}

const initialOf = (kind: RematchKind, item: IdentifyItem | undefined): IdentifyInitial => {
  if (kind !== 'episode') return { mode: kind, query: item?.title ?? '' }
  return {
    mode: 'episode',
    query: item?.seriesTitle ?? '',
    ...(item?.seasonNumber === undefined ? {} : { season: item.seasonNumber }),
    ...(item?.episodeNumber === undefined ? {} : { episode: item.episodeNumber }),
  }
}

const topLevelOf = async (id: string): Promise<string> => {
  let item = await request(() => api.items[':id'].$get({ param: { id } }))
  for (let hop = 0; hop < 2 && item.kind !== 'movie' && item.kind !== 'series'; hop += 1) {
    const parentId = item.parentId
    if (parentId === undefined) break
    item = await request(() => api.items[':id'].$get({ param: { id: parentId } }))
  }
  return item.id
}

export const RematchDialog = ({
  itemId,
  kind,
  open,
  onClose,
}: {
  itemId: string
  kind: 'movie' | 'series' | 'episode'
  open: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const formId = useId()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [leftForReview, setLeftForReview] = useState(0)
  const item = useQuery({ ...identifyItemQuery(itemId), enabled: open })

  const rematch = useMutation({
    mutationFn: async (body: AssignBody) => {
      const result = await request(() =>
        api.admin.items[':id'].rematch.$post({ param: { id: itemId }, json: body }),
      )
      const first = result.itemIds[0]
      const review = result.needsReview.length
      if (kind === 'episode' || first === undefined) return { review }
      if (body.kind === 'movie') {
        return result.itemIds.includes(itemId) ? { review } : { review, movedTo: first }
      }
      const target = await topLevelOf(first).catch(() => undefined)
      return target === undefined || target === itemId ? { review } : { review, movedTo: target }
    },
    onSuccess: async ({ review, movedTo }) => {
      setReady(false)
      if (review > 0) setLeftForReview(review)
      else onClose()
      if (movedTo !== undefined) {
        await navigate({ to: '/items/$itemId', params: { itemId: movedTo } })
      }
      await invalidateAfterIdentify(queryClient)
    },
  })

  const close = () => {
    if (rematch.isPending) return
    rematch.reset()
    setReady(false)
    setLeftForReview(0)
    onClose()
  }

  return (
    <Dialog
      open={open}
      fill
      title={t('admin.identify.title')}
      onClose={close}
      footer={
        leftForReview > 0 ? (
          <>
            <Link to="/admin/review" className="button" onClick={close}>
              {t('admin.review.title')}
            </Link>
            <button type="button" className="button button--primary" onClick={close}>
              {t('common.close')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button" onClick={close}>
              {t('common.cancel')}
            </button>
            <IdentifySubmit formId={formId} pending={rematch.isPending} ready={ready} />
          </>
        )
      }
    >
      {leftForReview > 0 ? (
        <EmptyState title={t('admin.identify.leftForReview', { count: leftForReview })} />
      ) : item.isPending ? (
        <div className="identify identify--loading" aria-busy="true">
          <span className="skeleton identify__skeleton-block" />
        </div>
      ) : (
        <IdentifyForm
          key={itemId}
          formId={formId}
          modes={modesOf[kind]}
          initial={initialOf(kind, item.data)}
          {...(rematch.isError ? { error: rematch.error } : {})}
          onSelect={setReady}
          onSubmit={(body) => rematch.mutate(body)}
        />
      )}
    </Dialog>
  )
}
