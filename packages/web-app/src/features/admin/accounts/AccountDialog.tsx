import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AccountRole, passwordSchema, usernameSchema } from '@projo/shared/api/auth'
import type { AdminAccountDto } from '@projo/shared/api/accounts'
import type { AvatarColor } from '@projo/shared/api/profiles'

import { api, request } from '../../../shared/api/client.ts'
import { formatDateTime } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field, RevealButton } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { LockIcon, PlusIcon, UserIcon } from '../../../shared/ui/icons.tsx'
import { Segmented } from '../../../shared/ui/Segmented.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { DialogTabPanel, DialogTabs } from '../DialogTabs.tsx'
import { librariesQuery } from '../queries.ts'
import { AccountActivity } from './AccountActivity.tsx'
import { type AccountFormStatus, AccountSettings } from './AccountSettings.tsx'
import { avatarColors, ColorPicker } from './parts.tsx'
import { ProfileCard } from './ProfileCard.tsx'
import { accountsQuery, accountsQueryKey } from './queries.ts'
import '../admin.css'
import '../admin-table.css'
import './accounts.css'

const maxProfiles = 5
const roles: readonly AccountRole[] = ['user', 'admin']
const idle: AccountFormStatus = { dirty: false, pending: false }

type Tab = 'account' | 'profiles' | 'activity'

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

const Profiles = ({ account }: { account: AdminAccountDto }) => {
  const { t } = useTranslation()
  const libraries = useQuery(librariesQuery)
  const [adding, setAdding] = useState(false)
  return (
    <>
      <div className="acc-section-head">
        <span className="acc-section-head__count">
          {account.profiles.length} / {maxProfiles}
        </span>
        <button
          type="button"
          className="button button--glass button--small"
          disabled={account.profiles.length >= maxProfiles}
          onClick={() => setAdding(true)}
        >
          <PlusIcon />
          {t('admin.accounts.addProfile')}
        </button>
      </div>
      <div className="acc-cards">
        {account.profiles.map((profile) => (
          <ProfileCard key={profile.id} profile={profile} libraries={libraries.data?.items ?? []} />
        ))}
      </div>
      {adding ? <AddProfileDialog account={account} onClose={() => setAdding(false)} /> : undefined}
    </>
  )
}

const Activity = ({ account }: { account: AdminAccountDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (
    <dl className="adm-details">
      <dt>{t('admin.accounts.details.lastSeen')}</dt>
      <dd>
        <AccountActivity account={account} />
      </dd>
      <dt>{t('admin.accounts.details.sessions')}</dt>
      <dd>{t('admin.accounts.sessions', { count: account.activeSessions })}</dd>
      <dt>{t('admin.accounts.details.created')}</dt>
      <dd>{formatDateTime(account.createdAt, locale)}</dd>
      {account.disabledAt === undefined ? undefined : (
        <>
          <dt>{t('admin.accounts.details.disabled')}</dt>
          <dd>{formatDateTime(account.disabledAt, locale)}</dd>
        </>
      )}
    </dl>
  )
}

/**
 * An account's details (§15): its role and state under its name, then tabs: the account (its
 * settings and the actions on it), its profiles (each card saved on its own), its activity.
 */
export const AccountDialog = ({
  accountId,
  onClose,
}: {
  accountId: string
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const formId = `${ids}-form`
  const accounts = useQuery(accountsQuery)
  const [tab, setTab] = useState<Tab>('account')
  const [status, setStatus] = useState<AccountFormStatus>(idle)
  const account = accounts.data?.items.find((candidate) => candidate.id === accountId)

  return (
    <Dialog
      open
      large
      title={account?.username ?? t('common.loading')}
      subtitle={
        account === undefined ? undefined : (
          <>
            <span className="acc-pill">{t(`admin.accounts.role.${account.role}`)}</span>
            {account.disabledAt === undefined ? undefined : (
              <span className="acc-pill acc-pill--off">{t('admin.accounts.disabledBadge')}</span>
            )}
          </>
        )
      }
      tabs={
        <DialogTabs
          idPrefix={ids}
          label={account?.username ?? t('admin.accounts.title')}
          tabs={[
            { value: 'account', label: t('admin.accounts.columns.account') },
            { value: 'profiles', label: t('admin.accounts.columns.profiles') },
            { value: 'activity', label: t('admin.accounts.columns.activity') },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
      onClose={onClose}
      footer={
        tab === 'account' ? (
          <>
            <button type="button" className="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form={formId}
              className="button button--primary"
              disabled={!status.dirty || status.pending}
            >
              {status.pending ? <span className="spinner" aria-hidden="true" /> : undefined}
              {t('common.save')}
            </button>
          </>
        ) : (
          <button type="button" className="button" onClick={onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      {accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : accounts.isPending ? (
        <div className="skeleton acc-dialog__skeleton" aria-hidden="true" />
      ) : account === undefined ? (
        <EmptyState compact title={t('admin.accounts.notFound')} />
      ) : (
        <>
          <DialogTabPanel idPrefix={ids} value="account" current={tab}>
            <AccountSettings
              account={account}
              formId={formId}
              onStatusChange={setStatus}
              onSaved={onClose}
              onDeleted={onClose}
            />
          </DialogTabPanel>
          <DialogTabPanel idPrefix={ids} value="profiles" current={tab}>
            <Profiles account={account} />
          </DialogTabPanel>
          <DialogTabPanel idPrefix={ids} value="activity" current={tab}>
            <Activity account={account} />
          </DialogTabPanel>
        </>
      )}
    </Dialog>
  )
}

/** A new account and its first profile; once created, its dialog opens (`onCreated`). */
export const NewAccountDialog = ({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (accountId: string) => void
}) => {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [role, setRole] = useState<AccountRole>('user')
  const [profileName, setProfileName] = useState('')
  const [avatarColor, setAvatarColor] = useState<AvatarColor>('blue')
  const [touched, setTouched] = useState(false)

  const usernameValid = usernameSchema.safeParse(username.trim()).success
  const passwordValid = passwordSchema.safeParse(password).success
  const profileValid = profileName.trim().length <= 32

  const create = useMutation({
    mutationFn: () =>
      request(() =>
        api.admin.accounts.$post({
          json: {
            username: username.trim(),
            password,
            role,
            uiLocale: currentLocale(),
            profile: {
              avatarColor,
              ...(profileName.trim() === '' ? {} : { name: profileName.trim() }),
            },
          },
        }),
      ),
    onSuccess: async (account) => {
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      onCreated(account.id)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (usernameValid && passwordValid && profileValid && !create.isPending) create.mutate()
  }

  return (
    <Dialog
      open
      large
      title={t('admin.accounts.createAccount.title')}
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
            {t('admin.accounts.createAccount.submit')}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} className="acc-create acc-create--page" onSubmit={submit} noValidate>
        {create.isError ? <ErrorAlert error={create.error} /> : undefined}
        <div className="form-row">
          <Field
            id={`${id}-username`}
            label={t('admin.accounts.createAccount.username')}
            icon={<UserIcon />}
            invalid={touched && !usernameValid}
          >
            <input
              id={`${id}-username`}
              className="field__input"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              value={username}
              aria-invalid={touched && !usernameValid}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          {touched && !usernameValid ? (
            <span className="hint hint--error">
              {t('admin.accounts.createAccount.usernameInvalid')}
            </span>
          ) : undefined}
        </div>
        <div className="form-row">
          <Field
            id={`${id}-password`}
            label={t('admin.accounts.createAccount.password')}
            icon={<LockIcon />}
            invalid={touched && !passwordValid}
            trail={<RevealButton shown={shown} onToggle={() => setShown(!shown)} />}
          >
            <input
              id={`${id}-password`}
              className="field__input"
              type={shown ? 'text' : 'password'}
              autoComplete="new-password"
              maxLength={256}
              value={password}
              aria-invalid={touched && !passwordValid}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {touched && !passwordValid ? (
            <span className="hint hint--error">{t('admin.accounts.passwordTooShort')}</span>
          ) : undefined}
        </div>
        <div className="acc-group-field">
          <span id={`${id}-role`} className="acc-label">
            {t('admin.accounts.roleLabel')}
          </span>
          <Segmented
            className="acc-seg"
            labelledBy={`${id}-role`}
            options={roles.map((value) => ({ value, label: t(`admin.accounts.role.${value}`) }))}
            value={role}
            onChange={setRole}
          />
        </div>
        <Field
          id={`${id}-profile`}
          label={t('admin.accounts.createAccount.profileName')}
          invalid={!profileValid}
        >
          <input
            id={`${id}-profile`}
            className="field__input"
            maxLength={32}
            placeholder={username.trim()}
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
          />
        </Field>
        <div className="acc-group-field">
          <span id={`${id}-color`} className="acc-label">
            {t('admin.accounts.profile.color')}
          </span>
          <ColorPicker value={avatarColor} labelId={`${id}-color`} onChange={setAvatarColor} />
        </div>
      </form>
    </Dialog>
  )
}
