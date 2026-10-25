import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SourceDto } from '@projo/shared/api/libraries'
import type { AssignBody } from '@projo/shared/api/metadata'

import { api, request } from '../../../shared/api/client.ts'
import { formatNumber } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { EyeOffIcon, FilmIcon, LayersIcon, TvIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorState } from '../../../shared/ui/states.tsx'
import { SearchIcon } from '../admin-icons.tsx'
import { IdentifyForm, IdentifySubmit } from '../identify/IdentifyForm.tsx'
import { invalidateAfterIdentify } from '../identify/queries.ts'
import { HideSourceDialog } from './HideSourceDialog.tsx'
import { fileName, initialFromSource, parsedSummary, reviewReason } from './parsed.ts'
import { reviewQuery } from './queries.ts'
import '../admin.css'
import './review.css'

const ClassificationIcon = ({ value }: { value: SourceDto['classification'] }) =>
  value === 'movie' ? <FilmIcon /> : value === 'episode' ? <TvIcon /> : <LayersIcon />

/** "It's a movie" / "it's an episode of…" for one source (§7.8). */
const IdentifySourceDialog = ({ source, onClose }: { source: SourceDto; onClose: () => void }) => {
  const { t } = useTranslation()
  const formId = useId()
  const queryClient = useQueryClient()
  const [ready, setReady] = useState(false)
  const assign = useMutation({
    mutationFn: (body: AssignBody) =>
      request(() =>
        api.admin.sources[':id'].assign.$post({ param: { id: source.id }, json: body }),
      ),
    onSuccess: async () => {
      onClose()
      await invalidateAfterIdentify(queryClient)
    },
  })
  return (
    <Dialog
      open
      fill
      title={t('admin.review.identifyTitle')}
      onClose={() => {
        if (!assign.isPending) onClose()
      }}
      footer={
        <>
          <button type="button" className="button" onClick={onClose} disabled={assign.isPending}>
            {t('common.cancel')}
          </button>
          <IdentifySubmit formId={formId} pending={assign.isPending} ready={ready} />
        </>
      }
    >
      <p className="review-file mono" title={source.path}>
        <bdi>{source.relativePath}</bdi>
      </p>
      <IdentifyForm
        formId={formId}
        modes={['movie', 'episode']}
        initial={initialFromSource(source)}
        {...(assign.isError ? { error: assign.error } : {})}
        onSelect={setReady}
        onSubmit={(body) => assign.mutate(body)}
      />
    </Dialog>
  )
}

const SkeletonRows = () => (
  <>
    {[0, 1, 2, 3].map((index) => (
      <li key={index} className="review-row review-row--skeleton" aria-hidden="true">
        <span className="skeleton lib-row__skeleton-icon" />
        <span className="skeleton skeleton--line review-row__skeleton-text" />
      </li>
    ))}
  </>
)

/** `/admin/review`: the "To review" queue (§7.8, §15, journey 5); a file can be hidden. */
export const ReviewPage = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queue = useInfiniteQuery(reviewQuery)
  const sources = queue.data?.pages.flatMap((page) => page.items) ?? []
  const [identifying, setIdentifying] = useState<SourceDto>()
  const [hiding, setHiding] = useState<SourceDto>()
  const total = queue.data?.pages[0]?.total ?? 0
  const hasMore = queue.hasNextPage

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <h1 className="admin-page__title">{t('admin.review.title')}</h1>
          {queue.isSuccess && sources.length > 0 ? (
            <p className="admin-page__summary">
              {t('admin.review.summary', {
                count: total,
                formatted: formatNumber(total, locale),
              })}
            </p>
          ) : undefined}
        </div>
      </div>

      {queue.isError && sources.length === 0 ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : queue.isSuccess && sources.length === 0 ? (
        <EmptyState title={t('admin.review.empty')} />
      ) : (
        <ul className="review-list" aria-label={t('admin.review.title')}>
          {queue.isPending ? <SkeletonRows /> : undefined}
          {sources.map((source) => {
            const reason = reviewReason(source.reviewReason)
            return (
              <li key={source.id} className="review-row">
                <span className="lib-row__icon" aria-hidden="true">
                  <ClassificationIcon value={source.classification} />
                </span>
                <div className="review-row__text">
                  <span className="review-row__name" title={source.relativePath}>
                    {fileName(source.relativePath)}
                  </span>
                  <span className="review-row__path mono" title={source.path}>
                    <bdi>{source.path}</bdi>
                  </span>
                </div>
                <div className="review-row__parsed">
                  <span className="review-row__kind">
                    {t(`admin.review.classification.${source.classification}`)}
                  </span>
                  <span className="review-row__summary">{parsedSummary(t, source)}</span>
                </div>
                <div className="review-row__reason">
                  <span className="badge">
                    {reason === undefined
                      ? (source.reviewReason ?? '—')
                      : t(`admin.review.reason.${reason}`)}
                  </span>
                </div>
                <div className="review-row__actions">
                  <button
                    type="button"
                    className="button button--glass button--small"
                    onClick={() => setIdentifying(source)}
                  >
                    <SearchIcon size={16} />
                    {t('admin.review.identify')}
                  </button>
                  <button
                    type="button"
                    className="button button--glass button--small"
                    aria-label={t('admin.hidden.hideNamed', {
                      name: fileName(source.relativePath),
                    })}
                    onClick={() => setHiding(source)}
                  >
                    <EyeOffIcon size={16} />
                    {t('admin.hidden.hide')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {hasMore ? (
        <button
          type="button"
          className="button button--glass button--small review-more"
          disabled={queue.isFetchingNextPage}
          onClick={() => void queue.fetchNextPage()}
        >
          {queue.isFetchingNextPage ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('admin.review.more')}
        </button>
      ) : undefined}

      {identifying === undefined ? undefined : (
        <IdentifySourceDialog
          key={identifying.id}
          source={identifying}
          onClose={() => setIdentifying(undefined)}
        />
      )}
      {hiding === undefined ? undefined : (
        <HideSourceDialog key={hiding.id} source={hiding} onClose={() => setHiding(undefined)} />
      )}
    </div>
  )
}
