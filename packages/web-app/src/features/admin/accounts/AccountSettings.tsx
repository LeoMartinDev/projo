import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AccountRole } from '@projo/shared/api/auth'
import type { AdminAccountDto, UpdateAccountBody } from '@projo/shared/api/accounts'

import { api, request } from '../../../shared/api/client.ts'
import { Field, RevealButton } from '../../../shared/ui/controls.tsx'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog.tsx'
import { CheckIcon, LockIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { Segmented } from '../../../shared/ui/Segmented.tsx'
import { Setting, SwitchSetting } from '../../../shared/ui/Setting.tsx'
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
    <ConfirmDialog
      title={t('admin.accounts.account.resetTitle', { username: account.username })}
      confirmLabel={t('admin.accounts.account.resetPassword')}
      form={`${id}-form`}
      pending={reset.isPending}
      error={reset.isError ? reset.error : undefined}
      onClose={onClose}
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
    </ConfirmDialog>
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
    <ConfirmDialog
      title={t('admin.accounts.account.deleteTitle', { username: account.username })}
      text={t('admin.accounts.account.deleteText')}
      confirmLabel={t('admin.accounts.account.delete')}
      tone="danger"
      form={`${id}-form`}
      pending={remove.isPending}
      disabled={!matches}
      error={remove.isError ? remove.error : undefined}
      onClose={onClose}
    >
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
    </ConfirmDialog>
  )
}

/** Where the account's form stands, for the buttons outside it (its dialog's footer). */
export type AccountFormStatus = { dirty: boolean; pending: boolean }

type Draft = { role: AccountRole; disabled: boolean }

const changesOf = (account: AdminAccountDto, draft: Draft): UpdateAccountBody | undefined => {
  const role = draft.role === account.role ? {} : { role: draft.role }
  const disabled =
    draft.disabled === (account.disabledAt !== undefined) ? {} : { disabled: draft.disabled }
  return role.role === undefined && disabled.disabled === undefined
    ? undefined
    : { ...role, ...disabled }
}

/**
 * The account itself (§15): its role and whether it is disabled, a form saved by the submit button
 * of the dialog holding it (`formId`, told by `onStatusChange`); resetting the password, revoking
 * its sessions and deleting it act at once, after their confirmation.
 */
export const AccountSettings = ({
  account,
  formId,
  onStatusChange,
  onSaved,
  onDeleted,
}: {
  account: AdminAccountDto
  formId: string
  onStatusChange: (status: AccountFormStatus) => void
  onSaved: () => void
  onDeleted: () => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'reset' | 'delete'>()
  const [draft, setDraft] = useState<Draft>(() => ({
    role: account.role,
    disabled: account.disabledAt !== undefined,
  }))

  const update = useMutation({
    mutationFn: (body: UpdateAccountBody) =>
      request(() => api.admin.accounts[':id'].$patch({ param: { id: account.id }, json: body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      onSaved()
    },
  })
  const changes = changesOf(account, draft)
  const dirty = changes !== undefined

  useEffect(() => {
    onStatusChange({ dirty, pending: update.isPending })
  }, [onStatusChange, dirty, update.isPending])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (changes !== undefined && !update.isPending) update.mutate(changes)
  }
  const revoke = useMutation({
    mutationFn: () =>
      request(() =>
        api.admin.accounts[':id']['revoke-sessions'].$post({ param: { id: account.id } }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountsQueryKey }),
  })

  const error = update.isError ? update.error : revoke.isError ? revoke.error : undefined

  return (
    <div className="acc-settings">
      <form id={formId} className="acc-settings__grid" onSubmit={submit} noValidate>
        <div className="acc-group-field">
          <span id={`${ids}-role`} className="acc-label">
            {t('admin.accounts.roleLabel')}
          </span>
          <Segmented
            className="acc-seg"
            labelledBy={`${ids}-role`}
            options={roles.map((role) => ({
              value: role,
              label: t(`admin.accounts.role.${role}`),
            }))}
            value={draft.role}
            disabled={update.isPending}
            onChange={(role) => setDraft({ ...draft, role })}
          />
        </div>

        <div className="acc-prefs">
          <SwitchSetting
            label={t('admin.accounts.account.disable')}
            checked={draft.disabled}
            onChange={(disabled) => setDraft({ ...draft, disabled })}
          />
          <Setting label={t('admin.accounts.account.password')}>
            <button
              type="button"
              className="button button--glass button--small"
              onClick={() => setDialog('reset')}
            >
              {t('admin.accounts.account.reset')}
            </button>
          </Setting>
          <Setting
            label={
              <>
                {t('admin.accounts.account.sessionsLabel')}
                <span className="acc-settings__count">
                  {t('admin.accounts.sessions', { count: account.activeSessions })}
                </span>
              </>
            }
          >
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
          </Setting>
          <Setting label={t('admin.accounts.account.delete')}>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => setDialog('delete')}
            >
              {t('admin.accounts.account.deleteShort')}
            </button>
          </Setting>
        </div>
      </form>

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
    </div>
  )
}
