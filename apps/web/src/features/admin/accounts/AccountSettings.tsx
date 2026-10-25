import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AccountRole } from '@projo/shared/api/auth'
import type { AdminAccountDto, UpdateAccountBody } from '@projo/shared/api/accounts'

import { api, request } from '../../../shared/api/client.ts'
import { Field, RevealButton, Switch } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { CheckIcon, LockIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { accountsQueryKey } from './queries.ts'

const roles: readonly AccountRole[] = ['admin', 'user']

const ResetPasswordDialog = ({
  account,
  onClose,
}: {
  account: AdminAccountDto
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [touched, setTouched] = useState(false)
  const valid = password.length >= 12 && password.length <= 256
  const reset = useMutation({
    mutationFn: () =>
      request(() =>
        api.admin.accounts[':id']['reset-password'].$post({
          param: { id: account.id },
          json: { password },
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
    if (valid && !reset.isPending) reset.mutate()
  }
  return (
    <Dialog
      open
      title={t('admin.accounts.account.resetTitle', { username: account.username })}
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
            disabled={reset.isPending}
          >
            {reset.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.accounts.account.resetPassword')}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} className="form-row" onSubmit={submit} noValidate>
        <Field
          id={`${id}-password`}
          label={t('admin.accounts.account.newPassword')}
          icon={<LockIcon />}
          invalid={touched && !valid}
          trail={<RevealButton shown={shown} onToggle={() => setShown(!shown)} />}
        >
          <input
            id={`${id}-password`}
            className="field__input"
            type={shown ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            maxLength={256}
            aria-invalid={touched && !valid}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {touched && !valid ? (
          <span className="hint hint--error">{t('admin.accounts.passwordTooShort')}</span>
        ) : undefined}
      </form>
      <p className="dialog__text">{t('admin.accounts.account.resetText')}</p>
      {reset.isError ? <ErrorAlert error={reset.error} /> : undefined}
    </Dialog>
  )
}

const DeleteAccountDialog = ({
  account,
  onClose,
  onDeleted,
}: {
  account: AdminAccountDto
  onClose: () => void
  onDeleted: () => void
}) => {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const [confirmUsername, setConfirmUsername] = useState('')
  const matches = confirmUsername.trim().toLowerCase() === account.username.toLowerCase()
  const remove = useMutation({
    mutationFn: () =>
      request(() =>
        api.admin.accounts[':id'].$delete({
          param: { id: account.id },
          json: { confirmUsername: confirmUsername.trim() },
        }),
      ),
    onSuccess: async () => {
      onClose()
      onDeleted()
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'invitations'] })
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (matches && !remove.isPending) remove.mutate()
  }
  return (
    <Dialog
      open
      title={t('admin.accounts.account.deleteTitle', { username: account.username })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form={`${id}-form`}
            className="button button--danger"
            disabled={!matches || remove.isPending}
          >
            {remove.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.accounts.account.delete')}
          </button>
        </>
      }
    >
      <p className="dialog__text">{t('admin.accounts.account.deleteText')}</p>
      <form id={`${id}-form`} onSubmit={submit} noValidate>
        <Field id={`${id}-confirm`} label={t('admin.accounts.account.confirmUsername')}>
          <input
            id={`${id}-confirm`}
            className="field__input"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={account.username}
            value={confirmUsername}
            onChange={(event) => setConfirmUsername(event.target.value)}
          />
        </Field>
      </form>
      {remove.isError ? <ErrorAlert error={remove.error} /> : undefined}
    </Dialog>
  )
}

/**
 * Settings of an account (§14, §15 Comptes), in its detail dialog: role, disable, reset the
 * password, revoke the sessions, delete (confirmed by typing the username; `onDeleted` then
 * closes the detail). 409 `account/last_admin` is shown as is.
 */
export const AccountSettings = ({
  account,
  onDeleted,
}: {
  account: AdminAccountDto
  onDeleted: () => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'reset' | 'delete'>()

  const update = useMutation({
    mutationFn: (body: UpdateAccountBody) =>
      request(() => api.admin.accounts[':id'].$patch({ param: { id: account.id }, json: body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountsQueryKey }),
  })
  const revoke = useMutation({
    mutationFn: () =>
      request(() =>
        api.admin.accounts[':id']['revoke-sessions'].$post({ param: { id: account.id } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountsQueryKey }),
  })

  const disabled = account.disabledAt !== undefined
  const error = update.isError ? update.error : revoke.isError ? revoke.error : undefined

  return (
    <section className="acc-settings" aria-label={t('admin.accounts.columns.account')}>
      <div className="acc-settings__grid">
        <div className="acc-group-field">
          <span id={`${ids}-role`} className="acc-label">
            {t('admin.accounts.roleLabel')}
          </span>
          <div
            className="seg acc-seg"
            role="radiogroup"
            aria-labelledby={`${ids}-role`}
            data-active={roles.indexOf(account.role)}
          >
            <span className="seg__indicator" aria-hidden="true" />
            {roles.map((role) => (
              <button
                key={role}
                type="button"
                role="radio"
                className="seg__option"
                aria-checked={account.role === role}
                disabled={update.isPending}
                onClick={() => {
                  if (account.role !== role) update.mutate({ role })
                }}
              >
                {t(`admin.accounts.role.${role}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="acc-prefs">
          <div className="setting">
            <span id={`${ids}-disabled`} className="setting__label">
              {t('admin.accounts.account.disable')}
            </span>
            <Switch
              checked={disabled}
              labelId={`${ids}-disabled`}
              onChange={(value) => update.mutate({ disabled: value })}
            />
          </div>
          <div className="setting">
            <span className="setting__label">{t('admin.accounts.account.password')}</span>
            <button
              type="button"
              className="button button--glass button--small"
              onClick={() => setDialog('reset')}
            >
              {t('admin.accounts.account.reset')}
            </button>
          </div>
          <div className="setting">
            <span className="setting__label">
              {t('admin.accounts.account.sessionsLabel')}
              <span className="acc-settings__count">
                {t('admin.accounts.sessions', { count: account.activeSessions })}
              </span>
            </span>
            <button
              type="button"
              className="button button--glass button--small"
              disabled={revoke.isPending || account.activeSessions === 0}
              onClick={() => revoke.mutate()}
            >
              {revoke.isPending ? (
                <span className="spinner" aria-hidden="true" />
              ) : revoke.isSuccess && account.activeSessions === 0 ? (
                <CheckIcon size={16} />
              ) : undefined}
              {t('admin.accounts.account.revokeSessions')}
            </button>
          </div>
          <div className="setting">
            <span className="setting__label">{t('admin.accounts.account.delete')}</span>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => setDialog('delete')}
            >
              {t('admin.accounts.account.deleteShort')}
            </button>
          </div>
        </div>
      </div>

      {error === undefined ? undefined : <ErrorAlert error={error} />}

      {dialog === 'reset' ? (
        <ResetPasswordDialog account={account} onClose={() => setDialog(undefined)} />
      ) : undefined}
      {dialog === 'delete' ? (
        <DeleteAccountDialog
          account={account}
          onClose={() => setDialog(undefined)}
          onDeleted={onDeleted}
        />
      ) : undefined}
    </section>
  )
}
