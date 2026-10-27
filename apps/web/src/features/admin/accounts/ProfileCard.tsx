import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminProfileDto } from '@projo/shared/api/accounts'
import type { LibraryDto } from '@projo/shared/api/libraries'
import type {
  AvatarColor,
  ContentRatingTier,
  LibraryAccess,
  UpdateProfileBody,
} from '@projo/shared/api/profiles'

import { api, request } from '../../../shared/api/client.ts'
import { toApiFailure } from '../../../shared/api/failure.ts'
import { profileUpdated, sessionQuery } from '../../../shared/session/session.ts'
import { Checkrow, Field, SelectChevron, Switch } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { toggleLibrary } from './library-access.ts'
import { AdminAvatar, ColorPicker, ratingOptions, useRatingLabel } from './parts.tsx'
import { accountsQueryKey } from './queries.ts'

type Draft = {
  name: string
  avatarColor: AvatarColor
  libraryAccess: LibraryAccess
  libraryIds: readonly string[]
  maxContentRating: ContentRatingTier | ''
  autoplayNext: boolean
  autoSkipIntro: boolean
  autoSkipCredits: boolean
  pinOn: boolean
  /** New PIN being typed: when the PIN is turned on, or changed. */
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
  pinOn: profile.hasPin,
  pin: '',
})

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id))

/** Only what changed: `PATCH /profiles/:id` leaves absent keys untouched. */
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
    ...(!draft.pinOn && profile.hasPin ? { pin: '' } : {}),
    ...(draft.pinOn && draft.pin !== '' ? { pin: draft.pin } : {}),
  }
}

const pinPattern = /^\d{4}$/u

const DeleteProfileDialog = ({
  profile,
  onClose,
}: {
  profile: AdminProfileDto
  onClose: () => void
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
      onClose()
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
    },
  })
  const failureCode = remove.isError ? toApiFailure(remove.error).code : undefined
  // The server asks for the PIN of a locked profile of one's own account that is not the active one.
  const askPin =
    profile.hasPin &&
    ((session?.status === 'signed_in' &&
      session.me.activeProfileId !== profile.id &&
      session.me.profiles.some((own) => own.id === profile.id)) ||
      failureCode === 'profile/pin_required' ||
      failureCode === 'profile/invalid_pin')
  return (
    <Dialog
      open
      title={t('admin.accounts.profile.deleteTitle', { name: profile.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={remove.isPending || (askPin && !pinPattern.test(currentPin))}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.accounts.profile.delete')}
          </button>
        </>
      }
    >
      <p className="dialog__text">{t('admin.accounts.profile.deleteText')}</p>
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
      {remove.isError ? <ErrorAlert error={remove.error} /> : undefined}
    </Dialog>
  )
}

/**
 * A profile on its account's page (artboard `AdminAccounts`), in the flow of the page: name,
 * colour, libraries, maximum rating, autoplay, skip intros, PIN, delete. An admin editing another
 * account's profile needs no PIN; on their own PIN-protected profiles the server asks for it
 * (`profile/pin_required`).
 */
export const ProfileCard = ({
  profile,
  libraries,
}: {
  profile: AdminProfileDto
  libraries: readonly LibraryDto[]
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const queryClient = useQueryClient()
  const ratingLabel = useRatingLabel()
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile))
  const [changingPin, setChangingPin] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [deleting, setDeleting] = useState(false)
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })

  const save = useMutation({
    mutationFn: (body: UpdateProfileBody) =>
      request(() =>
        api.profiles[':id'].$patch({
          param: { id: profile.id },
          json: pinPattern.test(currentPin) ? { ...body, currentPin } : body,
        }),
      ),
    onSuccess: async (saved) => {
      setDraft({ ...draftOf({ ...saved, playing: profile.playing }) })
      setChangingPin(false)
      profileUpdated(queryClient, saved)
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
    },
  })

  const changes = changesOf(profile, draft)
  const nameValid = draft.name.trim().length > 0 && draft.name.trim().length <= 32
  const needsNewPin = draft.pinOn && (!profile.hasPin || changingPin)
  const pinValid = !needsNewPin || pinPattern.test(draft.pin)
  const dirty = Object.keys(changes).length > 0
  const failureCode = save.isError ? toApiFailure(save.error).code : undefined
  const askCurrentPin =
    profile.hasPin &&
    (failureCode === 'profile/pin_required' || failureCode === 'profile/invalid_pin')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || !nameValid || !pinValid || save.isPending) return
    save.mutate(changes)
  }

  return (
    <form
      className="acc-card panel"
      aria-labelledby={`${ids}-title`}
      data-playing={profile.playing}
      onSubmit={submit}
      noValidate
    >
      <div className="acc-card__head">
        <AdminAvatar name={draft.name || profile.name} color={draft.avatarColor} size="large" />
        <h4 id={`${ids}-title`} className="acc-card__title">
          {profile.name}
        </h4>
        {profile.playing ? (
          <span className="acc-activity__when">
            <span className="dot dot--ok" aria-hidden="true" />
            {t('admin.accounts.playing')}
          </span>
        ) : undefined}
      </div>

      <div className="acc-card__body">
        <div className="acc-card__column">
          <Field id={`${ids}-name`} label={t('admin.accounts.profile.name')} invalid={!nameValid}>
            <input
              id={`${ids}-name`}
              className="field__input"
              value={draft.name}
              maxLength={32}
              aria-invalid={!nameValid}
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

          <Field
            id={`${ids}-rating`}
            label={t('admin.accounts.profile.maxRating')}
            trail={<SelectChevron />}
          >
            <select
              id={`${ids}-rating`}
              className="field__input"
              value={draft.maxContentRating}
              onChange={(event) => {
                const value = event.target.value
                const tier = ratingOptions.find((option) => option === value)
                set({ maxContentRating: tier ?? '' })
              }}
            >
              <option value="">{ratingLabel(undefined)}</option>
              {ratingOptions.map((tier) => (
                <option key={tier} value={tier}>
                  {ratingLabel(tier)}
                </option>
              ))}
            </select>
          </Field>

          <div className="acc-prefs">
            <div className="setting">
              <span id={`${ids}-autoplay`} className="setting__label">
                {t('admin.accounts.profile.autoplayNext')}
              </span>
              <Switch
                checked={draft.autoplayNext}
                labelId={`${ids}-autoplay`}
                onChange={(autoplayNext) => set({ autoplayNext })}
              />
            </div>
            <div className="setting">
              <span id={`${ids}-intro`} className="setting__label">
                {t('admin.accounts.profile.autoSkipIntro')}
              </span>
              <Switch
                checked={draft.autoSkipIntro}
                labelId={`${ids}-intro`}
                onChange={(autoSkipIntro) => set({ autoSkipIntro })}
              />
            </div>
            <div className="setting">
              <span id={`${ids}-credits`} className="setting__label">
                {t('admin.accounts.profile.autoSkipCredits')}
              </span>
              <Switch
                checked={draft.autoSkipCredits}
                labelId={`${ids}-credits`}
                onChange={(autoSkipCredits) => set({ autoSkipCredits })}
              />
            </div>
            <div className="setting">
              <span id={`${ids}-pin`} className="setting__label">
                {t('admin.accounts.profile.pin')}
              </span>
              <div className="acc-pin-switch">
                {profile.hasPin && draft.pinOn && !changingPin ? (
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
            </div>
            {needsNewPin ? (
              <Field id={`${ids}-new-pin`} label={t('admin.accounts.profile.newPin')} compact>
                <input
                  id={`${ids}-new-pin`}
                  className="field__input mono"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder={t('admin.accounts.profile.newPin')}
                  value={draft.pin}
                  onChange={(event) => set({ pin: event.target.value.replace(/\D/gu, '') })}
                />
              </Field>
            ) : undefined}
            {askCurrentPin ? (
              <Field
                id={`${ids}-current-pin`}
                label={t('admin.accounts.profile.currentPin')}
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
                  value={currentPin}
                  onChange={(event) => setCurrentPin(event.target.value.replace(/\D/gu, ''))}
                />
              </Field>
            ) : undefined}
          </div>
        </div>

        <div className="acc-card__column">
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
        </div>
      </div>

      {save.isError ? <ErrorAlert error={save.error} /> : undefined}

      <div className="acc-card__footer">
        <button
          type="button"
          className="button button--danger button--small"
          onClick={() => setDeleting(true)}
        >
          {t('admin.accounts.profile.delete')}
        </button>
        <button
          type="submit"
          className="button button--primary button--small"
          disabled={!dirty || !nameValid || !pinValid || save.isPending}
        >
          {save.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('common.save')}
        </button>
      </div>

      {deleting ? (
        <DeleteProfileDialog profile={profile} onClose={() => setDeleting(false)} />
      ) : undefined}
    </form>
  )
}
