import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AccountRole, passwordSchema, usernameSchema } from '@projo/shared/api/auth'
import type { AvatarColor } from '@projo/shared/api/profiles'

import { api, request } from '../../../shared/api/client.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field, RevealButton } from '../../../shared/ui/controls.tsx'
import { LockIcon, UserIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { AdminPageTitle } from '../AdminPageTitle.tsx'
import { ColorPicker } from './parts.tsx'
import { accountsQueryKey } from './queries.ts'
import '../admin.css'
import './accounts.css'

const roles: readonly AccountRole[] = ['user', 'admin']

export const NewAccountPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
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
      await navigate({
        to: '/admin/accounts/$accountId',
        params: { accountId: account.id },
        replace: true,
      })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (usernameValid && passwordValid && profileValid && !create.isPending) create.mutate()
  }

  return (
    <div className="admin-page">
      <div className="admin-page__heading">
        <AdminPageTitle back="/admin/accounts">
          {t('admin.accounts.createAccount.title')}
        </AdminPageTitle>
      </div>
      <form className="acc-create acc-create--page" onSubmit={submit} noValidate>
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
          <div
            className="seg acc-seg"
            role="radiogroup"
            aria-labelledby={`${id}-role`}
            data-active={roles.indexOf(role)}
          >
            <span className="seg__indicator" aria-hidden="true" />
            {roles.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                className="seg__option"
                aria-checked={role === value}
                onClick={() => setRole(value)}
              >
                {t(`admin.accounts.role.${value}`)}
              </button>
            ))}
          </div>
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
        <div className="admin-form__actions">
          <Link to="/admin/accounts" className="button">
            {t('common.cancel')}
          </Link>
          <button type="submit" className="button button--primary" disabled={create.isPending}>
            {create.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.accounts.createAccount.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
