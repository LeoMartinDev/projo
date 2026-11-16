import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { ReviewGroupDto } from '@projo/shared/api/libraries'

import { api, request } from '../../../shared/api/client.ts'
import { formatNumber } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog.tsx'
import { reviewQueryKey } from '../identify/queries.ts'
import { sourcesByStateQueryKey, statsQueryKey } from '../operations/queries.ts'

/** Hides every file of a series group at once (§7.8), after saying how many. */
export const HideGroupDialog = ({
  group,
  onClose,
}: {
  group: Pick<ReviewGroupDto, 'id' | 'count' | 'series' | 'first'>
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queryClient = useQueryClient()
  const hide = useMutation({
    mutationFn: () =>
      request(() => api.admin.sources[':id']['reject-group'].$post({ param: { id: group.id } })),
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
      title={t('admin.review.hideGroupTitle', {
        count: group.count,
        formatted: formatNumber(group.count, locale),
        series: group.series ?? group.first.displayTitle,
      })}
      text={t('admin.review.hideGroupText')}
      confirmLabel={t('admin.hidden.hide')}
      tone="danger"
      pending={hide.isPending}
      error={hide.isError ? hide.error : undefined}
      onConfirm={() => hide.mutate()}
      onClose={onClose}
    />
  )
}
