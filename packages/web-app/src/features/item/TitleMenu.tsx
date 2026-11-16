import { Link } from '@tanstack/react-router'
import { type KeyboardEvent, type MouseEvent, type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useErrorMessage } from '../../shared/i18n/errors.ts'
import { CheckIcon, MoreVerticalIcon } from '../../shared/ui/icons.tsx'
import { RematchDialog } from '../admin/identify/RematchDialog.tsx'
import { EditItemDialog } from '../admin/metadata/EditItemDialog.tsx'
import { useRefreshItem } from '../admin/metadata/queries.ts'
import { MarkersDialog } from './markers/MarkersDialog.tsx'

/** What the admin entries of a title's menu act on. */
export type AdminTarget = {
  itemId: string
  kind: 'movie' | 'series' | 'episode'
  name?: string
  durationMs?: number
  season?: { id: string; name: string }
}

type AdminDialog = 'rematch' | 'edit' | 'edit-season' | 'markers'

const refreshedMenuMs = 1200

const closeMenuOf = (element: HTMLElement) =>
  element.closest<HTMLElement>('[popover]')?.hidePopover()

/** Arrow keys, Home and End move between the enabled entries of a menu. */
const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])',
    ),
  ]
  if (items.length === 0) return
  const index = items.findIndex((item) => item === document.activeElement)
  const next =
    event.key === 'ArrowDown'
      ? items[(index + 1) % items.length]
      : event.key === 'ArrowUp'
        ? items[(index - 1 + items.length) % items.length]
        : event.key === 'Home'
          ? items[0]
          : event.key === 'End'
            ? items[items.length - 1]
            : undefined
  if (next === undefined) return
  event.preventDefault()
  next.focus()
}

/** A popover menu: the trigger's state follows the popover (Escape and outside clicks close it). */
const usePopoverMenu = () => {
  const id = useId()
  const [open, setOpen] = useState(false)
  return {
    open,
    trigger: { popoverTarget: id, 'aria-haspopup': 'menu', 'aria-expanded': open } as const,
    menu: {
      id,
      role: 'menu',
      popover: 'auto',
      onToggle: (event: { newState: string }) => setOpen(event.newState === 'open'),
      onKeyDown: moveFocus,
    } as const,
  }
}

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
          <span className="spinner title-menu__spinner" aria-hidden="true" />
        ) : undefined}
        {refresh.isSuccess ? <CheckIcon size={16} /> : undefined}
        {refresh.isSuccess ? t('admin.editItem.refreshQueued') : t('admin.editItem.refresh')}
      </button>
      {refresh.isError ? (
        <p className="title-menu__error" role="alert">
          {message(refresh.error)}
        </p>
      ) : undefined}
    </>
  )
}

const AdminItems = ({
  target,
  choose,
}: {
  target: AdminTarget
  choose: (event: MouseEvent<HTMLElement>, dialog: AdminDialog) => void
}) => {
  const { t } = useTranslation()
  return (
    <>
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
      {target.season === undefined ? undefined : (
        <button
          type="button"
          role="menuitem"
          className="menu__item"
          aria-haspopup="dialog"
          onClick={(event) => choose(event, 'edit-season')}
        >
          {t('admin.editItem.actionSeason', { name: target.season.name })}
        </button>
      )}
      <RefreshMenuItem itemId={target.itemId} />
      {target.kind === 'series' ? undefined : (
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
    </>
  )
}

const AdminDialogs = ({
  target,
  open,
  onClose,
}: {
  target: AdminTarget
  open: AdminDialog | undefined
  onClose: () => void
}) => {
  const { itemId, kind, name, durationMs, season } = target
  return (
    <>
      <RematchDialog itemId={itemId} kind={kind} open={open === 'rematch'} onClose={onClose} />
      <EditItemDialog
        itemId={itemId}
        {...(name === undefined ? {} : { name })}
        open={open === 'edit'}
        onClose={onClose}
      />
      {season === undefined ? undefined : (
        <EditItemDialog
          itemId={season.id}
          name={season.name}
          open={open === 'edit-season'}
          onClose={onClose}
        />
      )}
      {kind === 'series' ? undefined : (
        <MarkersDialog
          itemId={itemId}
          episode={kind === 'episode'}
          {...(name === undefined ? {} : { name })}
          {...(durationMs === undefined ? {} : { durationMs })}
          open={open === 'markers'}
          onClose={onClose}
        />
      )}
    </>
  )
}

const useAdminDialog = () => {
  const [dialog, setDialog] = useState<AdminDialog | undefined>(undefined)
  return {
    dialog,
    close: () => setDialog(undefined),
    choose: (event: MouseEvent<HTMLElement>, next: AdminDialog) => {
      closeMenuOf(event.currentTarget)
      setDialog(next)
    },
  }
}

/** The admin-only "⋮" of an episode row. */
export const AdminMenu = ({
  align = 'start',
  ...target
}: AdminTarget & { align?: 'start' | 'end' }) => {
  const { t } = useTranslation()
  const popover = usePopoverMenu()
  const admin = useAdminDialog()
  return (
    <div className={align === 'end' ? 'title-menu title-menu--end' : 'title-menu'}>
      <button
        type="button"
        className="title-menu__icon-button"
        aria-label={
          target.name === undefined
            ? t('item.adminMenu')
            : t('item.adminMenuOf', { name: target.name })
        }
        {...popover.trigger}
      >
        <MoreVerticalIcon size={20} />
      </button>
      <div className="menu title-menu__menu" {...popover.menu}>
        <AdminItems target={target} choose={admin.choose} />
      </div>
      <AdminDialogs target={target} open={admin.dialog} onClose={admin.close} />
    </div>
  )
}

const TitleMenuButton = ({
  fromStart,
  admin,
}: {
  fromStart: string | undefined
  admin: AdminTarget | undefined
}) => {
  const { t } = useTranslation()
  const popover = usePopoverMenu()
  const dialogs = useAdminDialog()
  const userItems: ReactNode =
    fromStart === undefined ? undefined : (
      <Link
        to="/watch/$itemId"
        params={{ itemId: fromStart }}
        search={{ from: 'start' }}
        role="menuitem"
        className="menu__item"
        onClick={(event) => closeMenuOf(event.currentTarget)}
      >
        {t('item.fromStart')}
      </Link>
    )
  return (
    // Back from the player started by "From the beginning", focus returns to the "⋮" (§19).
    <div className="title-menu" data-focus-key="detail:more">
      <button
        type="button"
        className="button button--glass button--large detail-action title-menu__button"
        aria-label={t('item.moreActions')}
        {...popover.trigger}
      >
        <MoreVerticalIcon size={20} />
        <span className="detail-action__label">{t('item.more')}</span>
      </button>
      <div className="menu title-menu__menu" {...popover.menu}>
        {userItems}
        {admin === undefined ? undefined : (
          <>
            {userItems === undefined ? undefined : (
              <span className="menu__separator" role="separator" />
            )}
            <AdminItems target={admin} choose={dialogs.choose} />
          </>
        )}
      </div>
      {admin === undefined ? undefined : (
        <AdminDialogs target={admin} open={dialogs.dialog} onClose={dialogs.close} />
      )}
    </div>
  )
}

/**
 * The hero's "⋮": "From the beginning" for everyone (`fromStart`: the item to restart), then the
 * admin entries for an admin. Nothing at all when it would be empty.
 */
export const TitleMenu = ({ fromStart, admin }: { fromStart?: string; admin?: AdminTarget }) =>
  fromStart === undefined && admin === undefined ? undefined : (
    <TitleMenuButton fromStart={fromStart} admin={admin} />
  )
