import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { LibraryDto } from '@projo/shared/api/libraries'

import { api, request } from '../../shared/api/client.ts'
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx'
import { librariesQueryKey } from './queries.ts'

export const DeleteLibraryDialog = ({
  library,
  onClose,
  onDeleted,
}: {
  library: LibraryDto
  onClose: () => void
  onDeleted: () => void
}) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () =>
      request(() => api.admin.libraries[':id'].$delete({ param: { id: library.id } })),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: [...librariesQueryKey, library.id] })
      await queryClient.invalidateQueries({ queryKey: librariesQueryKey })
      await queryClient.invalidateQueries({ queryKey: ['catalog'] })
      onDeleted()
    },
  })
  return (
    <ConfirmDialog
      title={t('admin.delete.title', { name: library.name })}
      text={t('admin.delete.text')}
      confirmLabel={t('admin.delete.confirm')}
      tone="danger"
      pending={remove.isPending}
      error={remove.isError ? remove.error : undefined}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    />
  )
}
