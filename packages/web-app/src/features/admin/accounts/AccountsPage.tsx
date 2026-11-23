import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminAccountDto } from '@projo/shared/api/accounts'

import { ChevronRightIcon, PlusIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { AccountActivity } from './AccountActivity.tsx'
import { AccountDialog, NewAccountDialog } from './AccountDialog.tsx'
import { InvitationCreatedDialog, Invitations, useCreateInvitation } from './Invitations.tsx'
import { AdminAvatar, useSummaryLabels } from './parts.tsx'
import { librariesQuery } from '../queries.ts'
import { accountsQuery } from './queries.ts'
import { profileSummary } from './summary.ts'
import { AdminSection } from '../AdminSection.tsx'
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

type Libraries = readonly { id: string; name: string }[]

const ProfileStack = ({
  account,
  libraries,
}: {
  account: AdminAccountDto
  libraries: Libraries
}) => {
  const { t } = useTranslation()
  const labels = useSummaryLabels()
  return (
    <ul
      className="acc-stack"
      aria-label={t('admin.accounts.profilesOf', { username: account.username })}
    >
      {account.profiles.map((profile) => {
        const label = `${profile.name} — ${profileSummary(profile, libraries, labels)}`
        return (
          <li key={profile.id} className="acc-stack__item" title={label}>
            <AdminAvatar name={profile.name} color={profile.avatarColor} size="small" />
            <span className="visually-hidden">{label}</span>
          </li>
        )
      })}
    </ul>
  )
}

const AccountRow = ({ account, libraries }: { account: AdminAccountDto; libraries: Libraries }) => {
  const { t } = useTranslation()
  return (
    <div className="acc-tr" role="row" data-disabled={account.disabledAt !== undefined}>
      <div className="acc-tr__name" role="cell">
        <AdminAvatar name={account.username} color="neutral" />
        <Link to="/admin/accounts" search={{ account: account.id }} className="acc-tr__link">
          {account.username}
        </Link>
        {account.disabledAt === undefined ? undefined : (
          <span className="acc-pill acc-pill--off">{t('admin.accounts.disabledBadge')}</span>
        )}
      </div>
      <div className="acc-tr__cell acc-tr__role" role="cell">
        <span className="acc-pill">{t(`admin.accounts.role.${account.role}`)}</span>
      </div>
      <div className="acc-tr__cell acc-tr__profiles" role="cell">
        <ProfileStack account={account} libraries={libraries} />
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
 * The accounts (§15): a table whose row opens the account's dialog, then the pending invitations.
 * `opened` is the `account` search parameter (an id, or `new`); `onOpen` replaces it.
 */
export const AccountsPage = ({
  opened,
  onOpen,
}: {
  opened: string | undefined
  onOpen: (opened: string | undefined) => void
}) => {
  const { t } = useTranslation()
  const accounts = useQuery(accountsQuery)
  const libraries = useQuery(librariesQuery)
  const [token, setToken] = useState<string>()
  const invite = useCreateInvitation(setToken)

  const items = accounts.data?.items ?? []

  return (
    <AdminSection
      title={t('admin.nav.accounts')}
      actions={
        <>
          <Link
            to="/admin/accounts"
            search={{ account: 'new' }}
            className="button button--glass button--small"
          >
            {t('admin.accounts.create')}
          </Link>
          <button
            type="button"
            className="button button--primary button--small"
            disabled={invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isPending ? <span className="spinner" aria-hidden="true" /> : <PlusIcon />}
            {t('admin.accounts.invite')}
          </button>
        </>
      }
    >
      {invite.isError ? <ErrorAlert error={invite.error} /> : undefined}

      {accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : accounts.isSuccess && items.length === 0 ? (
        <EmptyState compact title={t('admin.accounts.empty')} />
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
            <AccountRow
              key={account.id}
              account={account}
              libraries={libraries.data?.items ?? []}
            />
          ))}
        </div>
      )}

      <Invitations />

      {opened === 'new' ? (
        <NewAccountDialog onClose={() => onOpen(undefined)} onCreated={onOpen} />
      ) : opened === undefined ? undefined : (
        <AccountDialog key={opened} accountId={opened} onClose={() => onOpen(undefined)} />
      )}

      {token === undefined ? undefined : (
        <InvitationCreatedDialog token={token} onClose={() => setToken(undefined)} />
      )}
    </AdminSection>
  )
}
