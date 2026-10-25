import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { SourceDto } from '@projo/shared/api/libraries'

import { api, request } from '../../../shared/api/client.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { reviewQueryKey } from '../identify/queries.ts'
import { sourcesByStateQueryKey, statsQueryKey } from '../operations/queries.ts'
import { fileName } from './parsed.ts'

/** Hiding (§7.8, `state = rejected`): out of every list and scan until shown again from "Hidden". */
export const HideSourceDialog = ({
  source,
  onClose,
}: {
  source: SourceDto
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const hide = useMutation({
    mutationFn: () =>
      request(() => api.admin.sources[':id'].reject.$post({ param: { id: source.id } })),
    onSuccess: async () => {
      onClose()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewQueryKey }),
        queryClient.invalidateQueries({ queryKey: sourcesByStateQueryKey }),
      ])
      void queryClient.invalidateQueries({ queryKey: statsQueryKey })
    },
  })
  return (
    <Dialog
      open
      title={t('admin.hidden.hideTitle', { name: fileName(source.relativePath) })}
      onClose={() => {
        if (!hide.isPending) onClose()
      }}
      footer={
        <>
          <button type="button" className="button" disabled={hide.isPending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={hide.isPending}
            onClick={() => hide.mutate()}
          >
            {hide.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.hidden.hide')}
          </button>
        </>
      }
    >
      <p className="dialog__text">{t('admin.hidden.hideText')}</p>
      {hide.isError ? <ErrorAlert error={hide.error} /> : undefined}
    </Dialog>
  )
}
