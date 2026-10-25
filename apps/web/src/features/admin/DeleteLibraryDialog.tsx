import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { LibraryDto } from '@projo/shared/api/libraries'

import { api, request } from '../../shared/api/client.ts'
import { Dialog } from '../../shared/ui/Dialog.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { librariesQueryKey } from './queries.ts'

/** Deletion with confirmation (§15): sources and orphan items go, files on disk never do. */
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
    <Dialog
      open
      title={t('admin.delete.title', { name: library.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.delete.confirm')}
          </button>
        </>
      }
    >
      <p className="dialog__text">{t('admin.delete.text')}</p>
      {remove.isError ? <ErrorAlert error={remove.error} /> : undefined}
    </Dialog>
  )
}
