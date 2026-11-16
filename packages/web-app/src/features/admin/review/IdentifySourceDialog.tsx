import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SourceDto } from '@projo/shared/api/libraries'
import type { AssignBody } from '@projo/shared/api/metadata'

import { api, request } from '../../../shared/api/client.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { EmptyState } from '../../../shared/ui/states.tsx'
import { IdentifyForm, IdentifySubmit } from '../identify/IdentifyForm.tsx'
import { invalidateAfterIdentify } from '../identify/queries.ts'
import { initialFromSource } from './parsed.ts'
import { initialFromGroup } from './review-groups.ts'

/**
 * Identifies a file to review (§7.8). With `series`, the file is the first of a series group:
 * "It's an episode of…" on it takes the other files of the group along.
 */
export const IdentifySourceDialog = ({
  source,
  series = false,
  onClose,
}: {
  source: SourceDto
  series?: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const formId = useId()
  const queryClient = useQueryClient()
  const [ready, setReady] = useState(false)
  const [outcome, setOutcome] = useState<{ identified: number; left: number }>()
  const assign = useMutation({
    mutationFn: (body: AssignBody) =>
      request(() =>
        api.admin.sources[':id'].assign.$post({ param: { id: source.id }, json: body }),
      ),
    onSuccess: async ({ sourceIds, needsReview }) => {
      if (sourceIds.length > 1 || needsReview.length > 0)
        setOutcome({ identified: sourceIds.length, left: needsReview.length })
      else onClose()
      await invalidateAfterIdentify(queryClient)
    },
  })
  return (
    <Dialog
      open
      fill
      title={t(series ? 'admin.review.identifyGroupTitle' : 'admin.review.identifyTitle')}
      onClose={() => {
        if (!assign.isPending) onClose()
      }}
      footer={
        outcome === undefined ? (
          <>
            <button type="button" className="button" onClick={onClose} disabled={assign.isPending}>
              {t('common.cancel')}
            </button>
            <IdentifySubmit formId={formId} pending={assign.isPending} ready={ready} />
          </>
        ) : (
          <button type="button" className="button button--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      <p className="review-file mono" title={source.path}>
        <bdi>{source.relativePath}</bdi>
      </p>
      {outcome === undefined ? (
        <IdentifyForm
          formId={formId}
          modes={['movie', 'episode']}
          initial={series ? initialFromGroup(source) : initialFromSource(source)}
          {...(assign.isError ? { error: assign.error } : {})}
          onSelect={setReady}
          onSubmit={(body) => assign.mutate(body)}
        />
      ) : (
        <EmptyState
          title={t('admin.review.identified', { count: outcome.identified })}
          {...(outcome.left === 0
            ? {}
            : { text: t('admin.identify.leftForReview', { count: outcome.left }) })}
        />
      )}
    </Dialog>
  )
}
