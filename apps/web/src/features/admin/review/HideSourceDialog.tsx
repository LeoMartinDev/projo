import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { SourceDto } from '@projo/shared/api/libraries'

import { api, request } from '../../../shared/api/client.ts'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog.tsx'
import { reviewQueryKey } from '../identify/queries.ts'
import { sourcesByStateQueryKey, statsQueryKey } from '../operations/queries.ts'
import { fileName } from './parsed.ts'

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
    <ConfirmDialog
      title={t('admin.hidden.hideTitle', { name: fileName(source.relativePath) })}
      text={t('admin.hidden.hideText')}
      confirmLabel={t('admin.hidden.hide')}
      tone="danger"
      pending={hide.isPending}
      error={hide.isError ? hide.error : undefined}
      onConfirm={() => hide.mutate()}
      onClose={onClose}
    />
  )
}
