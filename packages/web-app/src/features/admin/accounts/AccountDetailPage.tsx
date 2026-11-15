import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminAccountDto } from '@projo/shared/api/accounts'
import type { AvatarColor } from '@projo/shared/api/profiles'

import { api, request } from '../../../shared/api/client.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { PlusIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { AdminPageHeader } from '../AdminPageHeader.tsx'
import { librariesQuery } from '../queries.ts'
import { AccountActivity } from './AccountActivity.tsx'
import { AccountSettings } from './AccountSettings.tsx'
import { avatarColors, ColorPicker } from './parts.tsx'
import { ProfileCard } from './ProfileCard.tsx'
import { accountsQuery, accountsQueryKey } from './queries.ts'
import '../admin.css'
import './accounts.css'

const maxProfiles = 5

const nextColor = (account: AdminAccountDto): AvatarColor =>
  avatarColors.find((color) => !account.profiles.some((p) => p.avatarColor === color)) ?? 'blue'

const AddProfileDialog = ({
  account,
  onClose,
}: {
  account: AdminAccountDto
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [avatarColor, setAvatarColor] = useState<AvatarColor>(() => nextColor(account))
  const [touched, setTouched] = useState(false)
  const valid = name.trim().length > 0 && name.trim().length <= 32
  const create = useMutation({
    mutationFn: () =>
      request(() =>
        api.admin.accounts[':id'].profiles.$post({
          param: { id: account.id },
          json: { name: name.trim(), avatarColor },
        }),
      ),
    onSuccess: async () => {
      onClose()
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (valid && !create.isPending) create.mutate()
  }
  return (
    <Dialog
      open
      title={t('admin.accounts.addProfileTitle', { username: account.username })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            className="button button--primary"
            disabled={create.isPending}
          >
            {create.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.accounts.addProfile')}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} className="acc-create" onSubmit={submit} noValidate>
        <Field
          id={`${id}-name`}
          label={t('admin.accounts.profile.name')}
          invalid={touched && !valid}
        >
          <input
            id={`${id}-name`}
            className="field__input"
            value={name}
            maxLength={32}
            autoComplete="off"
            aria-invalid={touched && !valid}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="acc-group-field">
          <span id={`${id}-color`} className="acc-label">
            {t('admin.accounts.profile.color')}
          </span>
          <ColorPicker value={avatarColor} labelId={`${id}-color`} onChange={setAvatarColor} />
        </div>
      </form>
      {create.isError ? <ErrorAlert error={create.error} /> : undefined}
    </Dialog>
  )
}

export const AccountDetailPage = ({ accountId }: { accountId: string }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const accounts = useQuery(accountsQuery)
  const libraries = useQuery(librariesQuery)
  const [adding, setAdding] = useState(false)

  if (accounts.isError)
    return (
      <div className="admin-page">
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      </div>
    )
  if (accounts.isPending)
    return (
      <div className="admin-page" aria-busy="true">
        <div className="skeleton skeleton--line admin-page__skeleton-title" />
        <div className="skeleton admin-page__skeleton-block" />
      </div>
    )

  const account = accounts.data.items.find((candidate) => candidate.id === accountId)
  if (account === undefined)
    return (
      <div className="admin-page">
        <EmptyState
          title={t('common.notFound')}
          action={
            <Link to="/admin/accounts" className="button button--glass">
              {t('admin.accounts.title')}
            </Link>
          }
        />
      </div>
    )

  const full = account.profiles.length >= maxProfiles
  return (
    <div className="admin-page acc-page">
      <AdminPageHeader
        title={account.username}
        back="/admin/accounts"
        summary={
          <div className="acc-head">
            <span className="acc-pill">{t(`admin.accounts.role.${account.role}`)}</span>
            {account.disabledAt === undefined ? undefined : (
              <span className="acc-pill acc-pill--off">{t('admin.accounts.disabledBadge')}</span>
            )}
            <AccountActivity account={account} />
          </div>
        }
      />

      <AccountSettings
        account={account}
        onDeleted={() => void navigate({ to: '/admin/accounts', replace: true })}
      />

      <section className="acc-profiles-section" aria-labelledby="acc-profiles-title">
        <div className="acc-section-head">
          <div className="acc-section-head__title">
            <h2 id="acc-profiles-title" className="admin-section__title">
              {t('admin.accounts.columns.profiles')}
            </h2>
            <span className="acc-section-head__count">
              {account.profiles.length} / {maxProfiles}
            </span>
          </div>
          <button
            type="button"
            className="button button--glass button--small"
            disabled={full}
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
            {t('admin.accounts.addProfile')}
          </button>
        </div>
        <div className="acc-cards">
          {account.profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              libraries={libraries.data?.items ?? []}
            />
          ))}
        </div>
      </section>

      {adding ? <AddProfileDialog account={account} onClose={() => setAdding(false)} /> : undefined}
    </div>
  )
}
