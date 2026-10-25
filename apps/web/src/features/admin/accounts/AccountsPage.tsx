import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminAccountDto } from '@projo/shared/api/accounts'

import { ChevronRightIcon, PlusIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { AccountActivity } from './AccountActivity.tsx'
import { AccountDialog } from './AccountDialog.tsx'
import { CreateAccountDialog } from './CreateAccountDialog.tsx'
import { InvitationCreatedDialog, Invitations, useCreateInvitation } from './Invitations.tsx'
import { AdminAvatar } from './parts.tsx'
import { librariesQuery } from '../queries.ts'
import { accountsQuery } from './queries.ts'
import '../admin.css'
import './accounts.css'

const SkeletonRows = () => (
  <>
    {[0, 1, 2].map((index) => (
      <div key={index} className="acc-tr acc-tr--skeleton" aria-hidden="true">
        <span className="skeleton acc-tr__skeleton-avatar" />
        <span className="skeleton skeleton--line acc-tr__skeleton-text" />
      </div>
    ))}
  </>
)

/** The profiles of an account as a stack of avatars, names for assistive technologies. */
const ProfileStack = ({ account }: { account: AdminAccountDto }) => {
  const { t } = useTranslation()
  return (
    <ul
      className="acc-stack"
      aria-label={t('admin.accounts.profilesOf', { username: account.username })}
    >
      {account.profiles.map((profile) => (
        <li key={profile.id} className="acc-stack__item" title={profile.name}>
          <AdminAvatar name={profile.name} color={profile.avatarColor} size="small" />
          <span className="visually-hidden">{profile.name}</span>
        </li>
      ))}
    </ul>
  )
}

const AccountRow = ({ account, onOpen }: { account: AdminAccountDto; onOpen: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className="acc-tr" role="row" data-disabled={account.disabledAt !== undefined}>
      <div className="acc-tr__name" role="cell">
        <AdminAvatar name={account.username} color="neutral" />
        <button type="button" className="acc-tr__link" aria-haspopup="dialog" onClick={onOpen}>
          {account.username}
        </button>
        {account.disabledAt === undefined ? undefined : (
          <span className="acc-pill acc-pill--off">{t('admin.accounts.disabledBadge')}</span>
        )}
      </div>
      <div className="acc-tr__cell acc-tr__role" role="cell">
        <span className="acc-pill">{t(`admin.accounts.role.${account.role}`)}</span>
      </div>
      <div className="acc-tr__cell acc-tr__profiles" role="cell">
        <ProfileStack account={account} />
      </div>
      <div className="acc-tr__cell acc-tr__activity" role="cell">
        <AccountActivity account={account} />
      </div>
      <div className="acc-tr__chevron" role="cell" aria-hidden="true">
        <ChevronRightIcon />
      </div>
    </div>
  )
}

/**
 * `/admin/accounts` (§14, §15 Comptes): a table of the accounts, then the pending invitations. A
 * row opens the account's detail (settings and profiles) in a dialog.
 */
export const AccountsPage = () => {
  const { t } = useTranslation()
  const accounts = useQuery(accountsQuery)
  const libraries = useQuery(librariesQuery)
  const [openId, setOpenId] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [token, setToken] = useState<string>()
  const invite = useCreateInvitation(setToken)

  const items = accounts.data?.items ?? []
  // Gone once deleted (or refetched without it): the dialog closes.
  const opened = items.find((account) => account.id === openId)
  const profileCount = items.reduce((total, account) => total + account.profiles.length, 0)

  return (
    <div className="admin-page acc-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <h1 className="admin-page__title">{t('admin.accounts.title')}</h1>
          {accounts.isSuccess ? (
            <p className="admin-page__summary">
              {[
                t('admin.accounts.summaryAccounts', { count: items.length }),
                t('admin.accounts.summaryProfiles', { count: profileCount }),
              ].join(' · ')}
            </p>
          ) : undefined}
        </div>
        <div className="admin-page__actions">
          <button
            type="button"
            className="button button--glass button--small"
            onClick={() => setCreating(true)}
          >
            {t('admin.accounts.create')}
          </button>
          <button
            type="button"
            className="button button--primary button--small"
            disabled={invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isPending ? <span className="spinner" aria-hidden="true" /> : <PlusIcon />}
            {t('admin.accounts.invite')}
          </button>
        </div>
      </div>

      {invite.isError ? <ErrorAlert error={invite.error} /> : undefined}

      {accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : accounts.isSuccess && items.length === 0 ? (
        <EmptyState title={t('admin.accounts.empty')} />
      ) : (
        <div className="acc-table" role="table" aria-label={t('admin.accounts.list')}>
          <div className="acc-tr acc-tr--head" role="row">
            <span role="columnheader">{t('admin.accounts.columns.account')}</span>
            <span role="columnheader">{t('admin.accounts.roleLabel')}</span>
            <span role="columnheader">{t('admin.accounts.columns.profiles')}</span>
            <span role="columnheader">{t('admin.accounts.columns.activity')}</span>
            <span role="columnheader" />
          </div>
          {accounts.isPending ? <SkeletonRows /> : undefined}
          {items.map((account) => (
            <AccountRow key={account.id} account={account} onOpen={() => setOpenId(account.id)} />
          ))}
        </div>
      )}

      <Invitations />

      {creating ? (
        <CreateAccountDialog
          onClose={() => setCreating(false)}
          onCreated={(account) => {
            setCreating(false)
            setOpenId(account.id)
          }}
        />
      ) : undefined}
      {opened === undefined ? undefined : (
        <AccountDialog
          key={opened.id}
          account={opened}
          libraries={libraries.data?.items ?? []}
          onClose={() => setOpenId(undefined)}
        />
      )}
      {token === undefined ? undefined : (
        <InvitationCreatedDialog token={token} onClose={() => setToken(undefined)} />
      )}
    </div>
  )
}
