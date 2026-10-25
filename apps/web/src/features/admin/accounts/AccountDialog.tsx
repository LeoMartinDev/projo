import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminAccountDto } from '@projo/shared/api/accounts'
import type { LibraryDto } from '@projo/shared/api/libraries'
import type { AvatarColor } from '@projo/shared/api/profiles'

import { api, request } from '../../../shared/api/client.ts'
import { Field } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { PlusIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { AccountActivity } from './AccountActivity.tsx'
import { AccountSettings } from './AccountSettings.tsx'
import { AdminAvatar, avatarColors, ColorPicker } from './parts.tsx'
import { ProfileCard } from './ProfileCard.tsx'
import { accountsQueryKey } from './queries.ts'

/** §14 / §24: 1 to 5 profiles per account. */
const maxProfiles = 5

/** The first colour the account does not use yet (as the server picks it). */
const nextColor = (account: AdminAccountDto): AvatarColor =>
  avatarColors.find((color) => !account.profiles.some((p) => p.avatarColor === color)) ?? 'blue'

/** `POST /admin/accounts/:id/profiles`: name and colour; the rest is edited on its card. */
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

/**
 * The detail of an account (§14, §15 Comptes), opened from its row of the table: the account
 * (role, deactivation, password, sessions, deletion), then each of its profiles with its settings,
 * and "Ajouter un profil" (up to 5). A modal of stable size; only its body scrolls.
 */
export const AccountDialog = ({
  account,
  libraries,
  onClose,
}: {
  account: AdminAccountDto
  libraries: readonly LibraryDto[]
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const full = account.profiles.length >= maxProfiles
  return (
    <Dialog open fill title={account.username} onClose={onClose}>
      <div className="acc-detail">
        <header className="acc-head">
          <AdminAvatar name={account.username} color="neutral" size="large" />
          <div className="acc-head__text">
            <div className="acc-head__title">
              <span className="acc-pill">{t(`admin.accounts.role.${account.role}`)}</span>
              {account.disabledAt === undefined ? undefined : (
                <span className="acc-pill acc-pill--off">{t('admin.accounts.disabledBadge')}</span>
              )}
            </div>
            <AccountActivity account={account} />
          </div>
        </header>

        <AccountSettings account={account} onDeleted={onClose} />

        <section className="acc-profiles-section" aria-labelledby="acc-profiles-title">
          <div className="acc-section-head">
            <div className="acc-section-head__title">
              <h3 id="acc-profiles-title" className="admin-section__title">
                {t('admin.accounts.columns.profiles')}
              </h3>
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
              <ProfileCard key={profile.id} profile={profile} libraries={libraries} />
            ))}
          </div>
        </section>
      </div>

      {adding ? <AddProfileDialog account={account} onClose={() => setAdding(false)} /> : undefined}
    </Dialog>
  )
}
