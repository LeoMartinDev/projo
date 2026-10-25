import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, request } from '../../shared/api/client.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Checkrow, Field } from '../../shared/ui/controls.tsx'
import { ArrowRightIcon, FolderIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { FolderBrowser } from '../admin/FolderBrowser.tsx'
import { nameFromFolder, parentOf } from '../admin/folder-paths.ts'
import { librariesQueryKey } from '../admin/queries.ts'
import { StepScreen } from './SetupLayout.tsx'

export type CreatedLibrary = { id: string; requestedAt: string }

type Folder = { path: string; checked: boolean }

/**
 * Step 2, artboard `OnbLibrary`: the first library's folders, picked with the explorer, and its
 * name, suggested by the first folder. No settings (§15 "Premier lancement"): content type
 * `auto` and the defaults of §6.2, changed later in the admin. Creating it starts the first scan.
 */
export const LibraryStep = ({ onDone }: { onDone: (library?: CreatedLibrary) => void }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queryClient = useQueryClient()
  const [folders, setFolders] = useState<readonly Folder[]>([])
  const [name, setName] = useState('')
  const [browserOpen, setBrowserOpen] = useState(false)

  const roots = folders.filter((folder) => folder.checked).map((folder) => folder.path)
  const ready = roots.length > 0 && name.trim().length > 0
  const lastFolder = folders.at(-1)?.path

  const create = useMutation({
    mutationFn: async () => {
      const requestedAt = new Date().toISOString()
      const library = await request(() =>
        api.admin.libraries.$post({ json: { name: name.trim(), roots } }),
      )
      return { id: library.id, requestedAt }
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: librariesQueryKey })
      onDone(created)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready && !create.isPending) create.mutate()
  }

  const addFolder = (path: string) => {
    setBrowserOpen(false)
    if (!folders.some((folder) => folder.path === path))
      setFolders([...folders, { path, checked: true }])
    if (name.trim().length === 0) setName(nameFromFolder(path, locale))
  }

  const toggle = (path: string, checked: boolean) =>
    setFolders(folders.map((folder) => (folder.path === path ? { ...folder, checked } : folder)))

  return (
    <StepScreen step="library" image="lighthouse" title={t('setup.library.display')}>
      <form
        className="panel onb__panel onb__panel--wide rise r2"
        aria-labelledby="setup-library-title"
        onSubmit={submit}
        noValidate
      >
        <h2 id="setup-library-title" className="onb__panel-title">
          {t('setup.library.title')}
        </h2>
        {create.isError ? <ErrorAlert error={create.error} /> : undefined}

        <Field id="setup-library-name" label={t('admin.form.name')}>
          <input
            id="setup-library-name"
            className="field__input"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <div className="onb__folders">
          <div className="onb__folders-head">
            <span id="setup-folders" className="onb__label">
              {t('admin.form.folders')}
            </span>
            <button
              type="button"
              className="button button--glass button--small"
              onClick={() => setBrowserOpen(true)}
            >
              <FolderIcon size={15} />
              {t('setup.library.browse')}
            </button>
          </div>
          {folders.length > 0 ? (
            <ul className="well onb__folder-list" aria-labelledby="setup-folders">
              {folders.map((folder) => (
                <li key={folder.path}>
                  <Checkrow
                    checked={folder.checked}
                    onChange={(checked) => toggle(folder.path, checked)}
                  >
                    <span className="checkrow__label mono onb__path">
                      <bdi>{folder.path}</bdi>
                    </span>
                  </Checkrow>
                </li>
              ))}
            </ul>
          ) : undefined}
        </div>

        <div className="onb__actions">
          <button type="button" className="button" onClick={() => onDone()}>
            {t('setup.library.later')}
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={!ready || create.isPending}
          >
            {create.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('setup.library.submit')}
            <span className="button__arrow" aria-hidden="true">
              <ArrowRightIcon size={17} />
            </span>
          </button>
        </div>
      </form>

      {browserOpen ? (
        <FolderBrowser
          open
          initialPath={lastFolder === undefined ? '/' : parentOf(lastFolder)}
          onClose={() => setBrowserOpen(false)}
          onPick={addFolder}
        />
      ) : undefined}
    </StepScreen>
  )
}
