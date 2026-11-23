import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminAccountDto, AdminProfileDto } from '@projo/shared/api/accounts'
import type { LibraryDto } from '@projo/shared/api/libraries'
import type {
  AvatarColor,
  ContentRatingTier,
  CreateProfileBody,
  LibraryAccess,
  UpdateProfileBody,
} from '@projo/shared/api/profiles'

import { api, request } from '../../../shared/api/client.ts'
import { toApiFailure } from '../../../shared/api/failure.ts'
import { profileUpdated, sessionQuery } from '../../../shared/session/session.ts'
import { Checkrow, Field, Switch } from '../../../shared/ui/controls.tsx'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog.tsx'
import { BackIcon } from '../../../shared/ui/icons.tsx'
import { SelectField } from '../../../shared/ui/Select.tsx'
import { Setting, SwitchSetting } from '../../../shared/ui/Setting.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { useElement } from '../../../shared/ui/use-element.ts'
import { profilesQuery } from '../../profiles/queries.ts'
import { tvQueryKey } from '../../tv/queries.ts'
import { toggleLibrary } from './library-access.ts'
import { AdminAvatar, avatarColors, ColorPicker, ratingOptions, useRatingLabel } from './parts.tsx'
import { accountsQueryKey } from './queries.ts'

/** Where the profile's form stands, for the buttons outside it (its dialog's footer). */
export type ProfileFormStatus = { dirty: boolean; pending: boolean }

type Draft = {
  name: string
  avatarColor: AvatarColor
  libraryAccess: LibraryAccess
  libraryIds: readonly string[]
  maxContentRating: ContentRatingTier | ''
  autoplayNext: boolean
  autoSkipIntro: boolean
  autoSkipCredits: boolean
  liveTv: boolean
  pinOn: boolean
  pin: string
}

const draftOf = (profile: AdminProfileDto): Draft => ({
  name: profile.name,
  avatarColor: profile.avatarColor,
  libraryAccess: profile.libraryAccess,
  libraryIds: profile.libraryIds,
  maxContentRating: profile.maxContentRating ?? '',
  autoplayNext: profile.autoplayNext,
  autoSkipIntro: profile.autoSkipIntro,
  autoSkipCredits: profile.autoSkipCredits,
  // Absent from servers before the guide slice: on (§29.6).
  liveTv: profile.liveTv !== false,
  pinOn: profile.hasPin,
  pin: '',
})

/** A new profile: the server's defaults (§14), in the first colour the account does not use yet. */
const newDraft = (account: AdminAccountDto): Draft => ({
  name: '',
  avatarColor:
    avatarColors.find((color) => !account.profiles.some((p) => p.avatarColor === color)) ?? 'blue',
  libraryAccess: 'all',
  libraryIds: [],
  maxContentRating: '',
  autoplayNext: true,
  autoSkipIntro: false,
  autoSkipCredits: false,
  liveTv: true,
  pinOn: false,
  pin: '',
})

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

const changesOf = (profile: AdminProfileDto, draft: Draft): UpdateProfileBody => {
  const name = draft.name.trim()
  const accessChanged =
    draft.libraryAccess !== profile.libraryAccess ||
    (draft.libraryAccess === 'selected' && !sameIds(draft.libraryIds, profile.libraryIds))
  return {
    ...(name !== profile.name ? { name } : {}),
    ...(draft.avatarColor !== profile.avatarColor ? { avatarColor: draft.avatarColor } : {}),
    ...(accessChanged
      ? {
          libraryAccess: draft.libraryAccess,
          ...(draft.libraryAccess === 'selected' ? { libraryIds: [...draft.libraryIds] } : {}),
        }
      : {}),
    ...(draft.maxContentRating !== (profile.maxContentRating ?? '')
      ? { maxContentRating: draft.maxContentRating }
      : {}),
    ...(draft.autoplayNext !== profile.autoplayNext ? { autoplayNext: draft.autoplayNext } : {}),
    ...(draft.autoSkipIntro !== profile.autoSkipIntro
      ? { autoSkipIntro: draft.autoSkipIntro }
      : {}),
    ...(draft.autoSkipCredits !== profile.autoSkipCredits
      ? { autoSkipCredits: draft.autoSkipCredits }
      : {}),
    ...(draft.liveTv !== (profile.liveTv !== false) ? { liveTv: draft.liveTv } : {}),
    ...(!draft.pinOn && profile.hasPin ? { pin: '' } : {}),
    ...(draft.pinOn && draft.pin !== '' ? { pin: draft.pin } : {}),
  }
}

const creationOf = (draft: Draft): CreateProfileBody => ({
  name: draft.name.trim(),
  avatarColor: draft.avatarColor,
  libraryAccess: draft.libraryAccess,
  ...(draft.libraryAccess === 'selected' ? { libraryIds: [...draft.libraryIds] } : {}),
  ...(draft.maxContentRating === '' ? {} : { maxContentRating: draft.maxContentRating }),
  autoplayNext: draft.autoplayNext,
  autoSkipIntro: draft.autoSkipIntro,
  autoSkipCredits: draft.autoSkipCredits,
  liveTv: draft.liveTv,
  ...(draft.pinOn ? { pin: draft.pin } : {}),
})

const pinPattern = /^\d{4}$/u

/** A profile added to or deleted from the admin's own account: its profile picker shows them too. */
const ownProfilesChanged = async (queryClient: QueryClient, accountId: string) => {
  const session = queryClient.getQueryData(sessionQuery.queryKey)
  if (session?.status !== 'signed_in' || session.me.account.id !== accountId) return
  await queryClient.invalidateQueries({ queryKey: profilesQuery.queryKey })
  await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
}

const DeleteProfileDialog = ({
  accountId,
  profile,
  onClose,
  onDeleted,
}: {
  accountId: string
  profile: AdminProfileDto
  onClose: () => void
  onDeleted: () => void
}) => {
  const { t } = useTranslation()
  const id = useId()
  const queryClient = useQueryClient()
  const session = useQuery(sessionQuery).data
  const [currentPin, setCurrentPin] = useState('')
  const remove = useMutation({
    mutationFn: () =>
      request(() =>
        api.profiles[':id'].$delete({
          param: { id: profile.id },
          json: pinPattern.test(currentPin) ? { currentPin } : {},
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      await ownProfilesChanged(queryClient, accountId)
      onDeleted()
    },
  })
  const failureCode = remove.isError ? toApiFailure(remove.error).code : undefined
  const askPin =
    profile.hasPin &&
    ((session?.status === 'signed_in' &&
      session.me.activeProfileId !== profile.id &&
      session.me.profiles.some((own) => own.id === profile.id)) ||
      failureCode === 'profile/pin_required' ||
      failureCode === 'profile/invalid_pin')
  return (
    <ConfirmDialog
      title={t('admin.accounts.profile.deleteTitle', { name: profile.name })}
      text={t('admin.accounts.profile.deleteText')}
      confirmLabel={t('admin.accounts.profile.delete')}
      tone="danger"
      pending={remove.isPending}
      disabled={askPin && !pinPattern.test(currentPin)}
      error={remove.isError ? remove.error : undefined}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    >
      {askPin ? (
        <Field
          id={`${id}-current-pin`}
          label={t('admin.accounts.profile.currentPin')}
          invalid={failureCode === 'profile/invalid_pin'}
          compact
        >
          <input
            id={`${id}-current-pin`}
            className="field__input mono"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder={t('admin.accounts.profile.currentPin')}
            aria-invalid={failureCode === 'profile/invalid_pin'}
            value={currentPin}
            onChange={(event) => setCurrentPin(event.target.value.replace(/\D/gu, ''))}
          />
        </Field>
      ) : undefined}
    </ConfirmDialog>
  )
}

/**
 * One profile of an account, opened from the Profiles tab of its dialog (§15): its name and
 * colour, its access (libraries, maximum rating, Live TV, PIN), its playback preferences, then
 * deleting it. `profile` absent: a new profile of `account`. A form saved by the submit button of
 * the dialog's footer (`formId`, told by `onStatusChange`); saving or deleting goes back to the
 * list (`onSaved`, `onDeleted`), and so does the back button (`backId`, `onBack`).
 */
export const ProfileForm = ({
  account,
  profile,
  libraries,
  formId,
  backId,
  onStatusChange,
  onBack,
  onSaved,
  onDeleted,
}: {
  account: AdminAccountDto
  profile?: AdminProfileDto
  libraries: readonly LibraryDto[]
  formId: string
  backId: string
  onStatusChange: (status: ProfileFormStatus) => void
  onBack: () => void
  onSaved: (profileId: string) => void
  onDeleted: () => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const queryClient = useQueryClient()
  const ratingLabel = useRatingLabel()
  const [form, formRef] = useElement<HTMLFormElement>()
  const [draft, setDraft] = useState<Draft>(() =>
    profile === undefined ? newDraft(account) : draftOf(profile),
  )
  const [touched, setTouched] = useState(false)
  const [changingPin, setChangingPin] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [deleting, setDeleting] = useState(false)
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProfileBody }) =>
      request(() =>
        api.profiles[':id'].$patch({
          param: { id },
          json: pinPattern.test(currentPin) ? { ...body, currentPin } : body,
        }),
      ),
    onSuccess: async (saved, { body }) => {
      profileUpdated(queryClient, saved)
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      // The active profile's channels, its "TV" entry with them (§29.6).
      if (body.liveTv !== undefined) await queryClient.invalidateQueries({ queryKey: tvQueryKey })
      onSaved(saved.id)
    },
  })
  const create = useMutation({
    mutationFn: (body: CreateProfileBody) =>
      request(() =>
        api.admin.accounts[':id'].profiles.$post({ param: { id: account.id }, json: body }),
      ),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      await ownProfilesChanged(queryClient, account.id)
      onSaved(created.id)
    },
  })
  const pending = update.isPending || create.isPending
  const error = update.isError ? update.error : create.isError ? create.error : undefined

  const changes = profile === undefined ? undefined : changesOf(profile, draft)
  const dirty = changes === undefined || Object.keys(changes).length > 0
  const nameValid = draft.name.trim().length > 0 && draft.name.trim().length <= 32
  const needsNewPin = draft.pinOn && (profile?.hasPin !== true || changingPin)
  const pinValid = !needsNewPin || pinPattern.test(draft.pin)
  const failureCode = update.isError ? toApiFailure(update.error).code : undefined
  const askCurrentPin =
    profile?.hasPin === true &&
    (failureCode === 'profile/pin_required' || failureCode === 'profile/invalid_pin')
  // An existing name is checked as it is typed; a new one once "Create" is pressed.
  const showNameInvalid = !nameValid && (touched || profile !== undefined)
  const canDelete = profile !== undefined && account.profiles.length > 1

  useEffect(() => {
    onStatusChange({ dirty, pending })
  }, [onStatusChange, dirty, pending])

  // A failure shows at the top of the form, wherever it was scrolled to; one asking for the
  // profile's PIN puts the focus in its field.
  useEffect(() => {
    if (error === undefined) return
    form?.closest('.dialog__body')?.scrollTo({ top: 0 })
    if (askCurrentPin) document.getElementById(`${ids}-current-pin`)?.focus()
  }, [form, error, askCurrentPin, ids])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!dirty || !nameValid || !pinValid || pending) return
    if (profile === undefined) create.mutate(creationOf(draft))
    else if (changes !== undefined) update.mutate({ id: profile.id, body: changes })
  }

  const titleId = `${ids}-title`
  return (
    <>
      <div className="acc-profile-head">
        <button
          id={backId}
          type="button"
          className="icon-button"
          aria-label={t('admin.accounts.profile.back')}
          onClick={onBack}
        >
          <BackIcon />
        </button>
        <AdminAvatar name={draft.name || (profile?.name ?? '')} color={draft.avatarColor} />
        <h3 id={titleId} className="acc-profile-head__name">
          {profile?.name ?? t('admin.accounts.profile.newTitle')}
        </h3>
        {profile?.playing === true ? (
          <span className="acc-activity__when">
            <span className="dot dot--ok" aria-hidden="true" />
            {t('admin.accounts.playing')}
          </span>
        ) : undefined}
      </div>

      <form
        ref={formRef}
        id={formId}
        className="acc-profile-form"
        aria-labelledby={titleId}
        onSubmit={submit}
        noValidate
      >
        {error === undefined ? undefined : <ErrorAlert error={error} />}

        <div className="acc-profile-form__section acc-profile-form__section--first">
          <div className="acc-profile-form__grid">
            <Field
              id={`${formId}-name`}
              label={t('admin.accounts.profile.name')}
              invalid={showNameInvalid}
            >
              <input
                id={`${formId}-name`}
                className="field__input"
                value={draft.name}
                maxLength={32}
                autoComplete="off"
                aria-invalid={showNameInvalid}
                onChange={(event) => set({ name: event.target.value })}
              />
            </Field>
            <div className="acc-group-field">
              <span id={`${ids}-color`} className="acc-label">
                {t('admin.accounts.profile.color')}
              </span>
              <ColorPicker
                value={draft.avatarColor}
                labelId={`${ids}-color`}
                onChange={(avatarColor) => set({ avatarColor })}
              />
            </div>
          </div>
        </div>

        <fieldset className="acc-profile-form__section">
          <legend className="acc-profile-form__legend">{t('admin.accounts.profile.access')}</legend>
          <div className="acc-profile-form__grid">
            <div className="acc-group-field">
              <span id={`${ids}-libraries`} className="acc-label">
                {t('admin.accounts.profile.libraries')}
              </span>
              <div className="acc-libraries well" role="group" aria-labelledby={`${ids}-libraries`}>
                {libraries.length === 0 ? (
                  <p className="acc-libraries__empty">{t('admin.accounts.profile.noLibraries')}</p>
                ) : (
                  <>
                    <Checkrow
                      checked={draft.libraryAccess === 'all'}
                      onChange={(checked) =>
                        set(
                          checked
                            ? { libraryAccess: 'all', libraryIds: [] }
                            : { libraryAccess: 'selected', libraryIds: [] },
                        )
                      }
                    >
                      <span className="checkrow__label">{t('admin.accounts.allLibraries')}</span>
                    </Checkrow>
                    {libraries.map((library) => (
                      <Checkrow
                        key={library.id}
                        checked={
                          draft.libraryAccess === 'all' || draft.libraryIds.includes(library.id)
                        }
                        onChange={(checked) =>
                          set(
                            toggleLibrary(
                              draft,
                              libraries.map(({ id }) => id),
                              library.id,
                              checked,
                            ),
                          )
                        }
                      >
                        <span className="checkrow__label">{library.name}</span>
                      </Checkrow>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="acc-profile-form__column">
              <SelectField
                id={`${ids}-rating`}
                label={t('admin.accounts.profile.maxRating')}
                value={draft.maxContentRating}
                options={[
                  { value: '' as const, label: ratingLabel(undefined) },
                  ...ratingOptions.map((tier) => ({ value: tier, label: ratingLabel(tier) })),
                ]}
                onChange={(maxContentRating) => set({ maxContentRating })}
              />
              <div className="acc-profile-form__rows">
                <SwitchSetting
                  label={t('admin.accounts.profile.liveTv')}
                  checked={draft.liveTv}
                  onChange={(liveTv) => set({ liveTv })}
                />
                <Setting label={t('admin.accounts.profile.pin')} labelId={`${ids}-pin`}>
                  <div className="acc-pin-switch">
                    {profile?.hasPin === true && draft.pinOn && !changingPin ? (
                      <button
                        type="button"
                        className="button button--small"
                        onClick={() => setChangingPin(true)}
                      >
                        {t('admin.accounts.profile.changePin')}
                      </button>
                    ) : undefined}
                    <Switch
                      checked={draft.pinOn}
                      labelId={`${ids}-pin`}
                      onChange={(pinOn) => {
                        set({ pinOn, pin: '' })
                        if (!pinOn) setChangingPin(false)
                      }}
                    />
                  </div>
                </Setting>
              </div>
              {needsNewPin ? (
                <Field
                  id={`${ids}-new-pin`}
                  label={t('admin.accounts.profile.newPin')}
                  invalid={touched && !pinValid}
                  compact
                >
                  <input
                    id={`${ids}-new-pin`}
                    className="field__input mono"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    placeholder={t('admin.accounts.profile.newPin')}
                    aria-invalid={touched && !pinValid}
                    value={draft.pin}
                    onChange={(event) => set({ pin: event.target.value.replace(/\D/gu, '') })}
                  />
                </Field>
              ) : undefined}
              {askCurrentPin ? (
                <Field
                  id={`${ids}-current-pin`}
                  label={t('admin.accounts.profile.currentPin')}
                  invalid={failureCode === 'profile/invalid_pin'}
                  compact
                >
                  <input
                    id={`${ids}-current-pin`}
                    className="field__input mono"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    placeholder={t('admin.accounts.profile.currentPin')}
                    aria-invalid={failureCode === 'profile/invalid_pin'}
                    value={currentPin}
                    onChange={(event) => setCurrentPin(event.target.value.replace(/\D/gu, ''))}
                  />
                </Field>
              ) : undefined}
            </div>
          </div>
        </fieldset>

        <fieldset className="acc-profile-form__section">
          <legend className="acc-profile-form__legend">
            {t('admin.accounts.profile.playback')}
          </legend>
          <div className="acc-profile-form__rows">
            <SwitchSetting
              label={t('admin.accounts.profile.autoplayNext')}
              checked={draft.autoplayNext}
              onChange={(autoplayNext) => set({ autoplayNext })}
            />
            <SwitchSetting
              label={t('admin.accounts.profile.autoSkipIntro')}
              checked={draft.autoSkipIntro}
              onChange={(autoSkipIntro) => set({ autoSkipIntro })}
            />
            <SwitchSetting
              label={t('admin.accounts.profile.autoSkipCredits')}
              checked={draft.autoSkipCredits}
              onChange={(autoSkipCredits) => set({ autoSkipCredits })}
            />
          </div>
        </fieldset>

        {canDelete ? (
          <div className="acc-profile-form__section">
            <div className="acc-profile-form__rows">
              <Setting label={t('admin.accounts.profile.delete')}>
                <button
                  type="button"
                  className="button button--danger button--small"
                  onClick={() => setDeleting(true)}
                >
                  {t('admin.accounts.profile.deleteShort')}
                </button>
              </Setting>
            </div>
          </div>
        ) : undefined}
      </form>

      {deleting && profile !== undefined ? (
        <DeleteProfileDialog
          accountId={account.id}
          profile={profile}
          onClose={() => setDeleting(false)}
          onDeleted={onDeleted}
        />
      ) : undefined}
    </>
  )
}
