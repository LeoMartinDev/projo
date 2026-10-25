import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, request } from '../../shared/api/client.ts'
import { Checkrow, Field } from '../../shared/ui/controls.tsx'
import { Dialog } from '../../shared/ui/Dialog.tsx'
import { ArrowUpIcon, ChevronRightIcon, FolderIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { parentOf } from './folder-paths.ts'
import './folder-browser.css'

const browseQuery = (path: string) => ({
  queryKey: ['admin', 'fs', path],
  queryFn: () => request(() => api.admin.fs.browse.$get({ query: { path } })),
  staleTime: 10_000,
  retry: false,
})

/** `/a/b/c` → [`/`, `/a`, `/a/b`, `/a/b/c`] with their labels, for the breadcrumb. */
const crumbs = (path: string) => {
  const parts = path.split('/').filter((part) => part.length > 0)
  return [
    { label: '/', path: '/' },
    ...parts.map((part, index) => ({
      label: part,
      path: `/${parts.slice(0, index + 1).join('/')}`,
    })),
  ]
}

/**
 * Folder explorer (§15, §20): `GET /admin/fs/browse`, directories only, read only. The admin
 * walks the server's tree and picks the current folder.
 */
export const FolderBrowser = ({
  open,
  initialPath,
  onClose,
  onPick,
}: {
  open: boolean
  initialPath: string
  onClose: () => void
  onPick: (path: string) => void
}) => {
  const { t } = useTranslation()
  const [path, setPath] = useState(initialPath)
  const [typed, setTyped] = useState(initialPath)
  const [showHidden, setShowHidden] = useState(false)
  const listing = useQuery({ ...browseQuery(path), enabled: open })

  const go = (next: string) => {
    setPath(next)
    setTyped(next)
  }

  const submitTyped = (event: FormEvent) => {
    event.preventDefault()
    const target = typed.trim()
    if (target.startsWith('/')) go(target)
  }

  const current = listing.data?.path ?? path
  // While loading or after an error there is no listing: the way up must stay reachable.
  const up = parentOf(current)
  const parent =
    listing.data === undefined ? (up === current ? undefined : up) : listing.data.parent

  // The breadcrumb stays on one line (stable dialog height): keep its deepest part in view.
  const [crumbsElement, crumbsRef] = useElement<HTMLElement>()
  useEffect(() => {
    crumbsElement?.scrollTo({ left: crumbsElement.scrollWidth })
  }, [crumbsElement, current])
  const entries = (listing.data?.entries ?? []).filter((entry) => showHidden || !entry.hidden)

  return (
    <Dialog
      open={open}
      fill
      title={t('admin.browser.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={listing.data === undefined}
            onClick={() => onPick(current)}
          >
            {t('admin.browser.pick')}
          </button>
        </>
      }
    >
      <form className="browser__path" onSubmit={submitTyped}>
        <Field
          id="browser-path"
          label={t('admin.browser.path')}
          compact
          icon={<FolderIcon />}
          trail={
            <span className="field__trail">
              <button type="submit" className="button button--glass button--small">
                {t('admin.browser.go')}
              </button>
            </span>
          }
        >
          <input
            id="browser-path"
            className="field__input mono"
            value={typed}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
      </form>

      <nav ref={crumbsRef} className="browser__crumbs" aria-label={t('admin.browser.breadcrumb')}>
        {crumbs(current).map((crumb, index, all) => (
          <span key={crumb.path} className="browser__crumb">
            {index > 1 ? <span aria-hidden="true">/</span> : undefined}
            {index === all.length - 1 ? (
              <span aria-current="location" className="mono">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                className="browser__crumb-link mono"
                onClick={() => go(crumb.path)}
              >
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </nav>

      <div className="browser__pane">
        {listing.isError ? <ErrorAlert error={listing.error} /> : undefined}

        <ul className="browser__list well" aria-busy={listing.isFetching}>
          {parent === undefined ? undefined : (
            <li>
              <button type="button" className="browser__entry" onClick={() => go(parent)}>
                <ArrowUpIcon size={16} />
                <span className="browser__name">{t('admin.browser.parent')}</span>
              </button>
            </li>
          )}
          {listing.isPending
            ? [0, 1, 2, 3, 4].map((index) => (
                <li key={index} className="skeleton browser__skeleton" aria-hidden="true" />
              ))
            : entries.map((entry) => (
                <li key={entry.path}>
                  <button type="button" className="browser__entry" onClick={() => go(entry.path)}>
                    <FolderIcon size={16} />
                    <span className="browser__name mono">{entry.name}</span>
                    <ChevronRightIcon size={16} />
                  </button>
                </li>
              ))}
          {listing.isSuccess && entries.length === 0 ? (
            <li className="browser__empty">{t('admin.browser.empty')}</li>
          ) : undefined}
        </ul>
      </div>

      <div className="browser__footer-row">
        <span className="browser__hidden">
          <Checkrow checked={showHidden} onChange={setShowHidden}>
            <span className="checkrow__label">{t('admin.browser.showHidden')}</span>
          </Checkrow>
        </span>
        {listing.data?.truncated === true ? (
          <span className="hint">{t('admin.browser.truncated')}</span>
        ) : undefined}
      </div>
    </Dialog>
  )
}
