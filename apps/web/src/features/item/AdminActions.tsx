import { type MouseEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CheckIcon, MoreVerticalIcon } from '../../shared/ui/icons.tsx'
import { useErrorMessage } from '../../shared/i18n/errors.ts'
import { RematchDialog } from '../admin/identify/RematchDialog.tsx'
import { EditItemDialog } from '../admin/metadata/EditItemDialog.tsx'
import { useRefreshItem } from '../admin/metadata/queries.ts'
import { MarkersDialog } from './markers/MarkersDialog.tsx'

type Open = 'rematch' | 'edit' | 'edit-season' | 'markers' | undefined

/** How long "Refresh started" stays in the menu before it closes. */
const refreshedMenuMs = 1200

/**
 * "Refresh" (§9.4): queues a `refresh_metadata` job; the page follows when it ends
 * (`catalog.changed`). The menu stays open to say it was queued, or why not.
 */
const RefreshMenuItem = ({ itemId }: { itemId: string }) => {
  const { t } = useTranslation()
  const message = useErrorMessage()
  const refresh = useRefreshItem()
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="menu__item"
        disabled={refresh.isPending}
        onClick={(event) => {
          const menu = event.currentTarget.closest<HTMLElement>('[popover]')
          refresh.mutate(itemId, {
            onSuccess: () =>
              setTimeout(() => {
                menu?.hidePopover()
                refresh.reset()
              }, refreshedMenuMs),
          })
        }}
      >
        {refresh.isPending ? (
          <span className="spinner admin-menu__spinner" aria-hidden="true" />
        ) : undefined}
        {refresh.isSuccess ? <CheckIcon size={16} /> : undefined}
        {refresh.isSuccess ? t('admin.editItem.refreshQueued') : t('admin.editItem.refresh')}
      </button>
      {refresh.isError ? (
        <p className="admin-menu__error" role="alert">
          {message(refresh.error)}
        </p>
      ) : undefined}
    </>
  )
}

/**
 * Admins only (§13.5): a discreet "⋮" at the end of the actions (of the page, or of an episode
 * row), whose menu holds "Fix the match" (TMDB rematch dialog), "Modifier" (§9.3, and on
 * a series the season shown), "Refresh" (§9.4) and, for a movie or an episode, "Markers"
 * (§12.5), so the viewer actions stay alone in the row.
 */
export const AdminMenu = ({
  itemId,
  kind,
  name,
  durationMs,
  season,
  align = 'start',
}: {
  itemId: string
  kind: 'movie' | 'series' | 'episode'
  /** Episode code, in the markers and editor dialog titles. */
  name?: string
  durationMs?: number
  /** Series page: the season shown, editable from the same menu. */
  season?: { id: string; name: string }
  /** `end`: the menu opens leftwards (a "⋮" at the right edge of an episode row). */
  align?: 'start' | 'end'
}) => {
  const { t } = useTranslation()
  const menuId = useId()
  const [dialog, setDialog] = useState<Open>(undefined)
  const choose = (event: MouseEvent<HTMLElement>, next: Exclude<Open, undefined>) => {
    event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
    setDialog(next)
  }
  return (
    <div className={align === 'end' ? 'admin-menu admin-menu--end' : 'admin-menu'}>
      <button
        type="button"
        className="admin-menu__button"
        aria-haspopup="menu"
        aria-label={name === undefined ? t('item.adminMenu') : t('item.adminMenuOf', { name })}
        popoverTarget={menuId}
      >
        <MoreVerticalIcon size={20} />
      </button>
      {/* Top layer (popover): never clipped by the hero's or a row's overflow. */}
      <div id={menuId} className="menu admin-menu__menu" role="menu" popover="auto">
        <button
          type="button"
          role="menuitem"
          className="menu__item"
          aria-haspopup="dialog"
          onClick={(event) => choose(event, 'rematch')}
        >
          {t('item.rematch')}
        </button>
        <button
          type="button"
          role="menuitem"
          className="menu__item"
          aria-haspopup="dialog"
          onClick={(event) => choose(event, 'edit')}
        >
          {t('admin.editItem.action')}
        </button>
        {season === undefined ? undefined : (
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            aria-haspopup="dialog"
            onClick={(event) => choose(event, 'edit-season')}
          >
            {t('admin.editItem.actionSeason', { name: season.name })}
          </button>
        )}
        <RefreshMenuItem itemId={itemId} />
        {kind === 'series' ? undefined : (
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            aria-haspopup="dialog"
            onClick={(event) => choose(event, 'markers')}
          >
            {t('item.markers.action')}
          </button>
        )}
      </div>
      <RematchDialog
        itemId={itemId}
        kind={kind}
        open={dialog === 'rematch'}
        onClose={() => setDialog(undefined)}
      />
      <EditItemDialog
        itemId={itemId}
        {...(name === undefined ? {} : { name })}
        open={dialog === 'edit'}
        onClose={() => setDialog(undefined)}
      />
      {season === undefined ? undefined : (
        <EditItemDialog
          itemId={season.id}
          name={season.name}
          open={dialog === 'edit-season'}
          onClose={() => setDialog(undefined)}
        />
      )}
      {kind === 'series' ? undefined : (
        <MarkersDialog
          itemId={itemId}
          episode={kind === 'episode'}
          {...(name === undefined ? {} : { name })}
          {...(durationMs === undefined ? {} : { durationMs })}
          open={dialog === 'markers'}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  )
}
