import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AvatarColor,
  pinSchema,
  type ProfileDto,
  profileNameSchema,
  type SubtitleMode,
  subtitleModeSchema,
  type UiLocale,
  type UpdateProfileBody,
} from '@projo/shared/api/profiles'

import { currentLocale } from '../../shared/i18n/index.ts'
import { pickActiveProfile } from '../../shared/session/active-profile.ts'
import { sessionQuery } from '../../shared/session/session.ts'
import { BackLink } from '../../shared/ui/BackLink.tsx'
import { Field, SelectChevron, Switch } from '../../shared/ui/controls.tsx'
import { ChevronLeftIcon } from '../../shared/ui/media-icons.tsx'
import { EmptyState, ErrorAlert } from '../../shared/ui/states.tsx'
import { languageName } from '../item/media-labels.ts'
import { Avatar } from '../shell/Avatar.tsx'
import { ColorSwatches, PinFields } from './IdentityFields.tsx'
import { useUpdateProfile } from './queries.ts'
import './profiles.css'

/** Languages offered for audio and subtitles (§11.1), ISO 639-1. */
const trackLanguages = [
  'fr',
  'en',
  'es',
  'de',
  'it',
  'pt',
  'nl',
  'sv',
  'da',
  'no',
  'fi',
  'pl',
  'cs',
  'ru',
  'uk',
  'tr',
  'el',
  'ar',
  'he',
  'hi',
  'ja',
  'ko',
  'zh',
  'th',
  'vi',
  'id',
] as const

const locales: readonly UiLocale[] = ['fr', 'en']

type Editable = Omit<UpdateProfileBody, 'currentPin' | 'pin' | 'libraryIds' | 'libraryAccess'>

/** A switch row of the kit (`.setting`): label, short description, switch. */
const SwitchSetting = ({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
}) => {
  const id = useId()
  return (
    <div className="setting">
      <div className="setting__text">
        <span id={id} className="setting__label">
          {label}
        </span>
        {description === undefined ? undefined : (
          <span className="setting__description">{description}</span>
        )}
      </div>
      <Switch checked={checked} labelId={id} onChange={onChange} />
    </div>
  )
}

const Panel = ({ title, children }: { title: string; children: ReactNode }) => {
  const id = useId()
  return (
    <section className="settings-panel" aria-labelledby={id}>
      <h2 id={id} className="settings-panel__title">
        {title}
      </h2>
      <div className="settings-panel__body">{children}</div>
    </section>
  )
}

/**
 * Name, colour and optional PIN of the profile (§13.6), edited in the page and saved with one
 * button. A restricted profile does not set or remove a PIN (§14): the PIN part is hidden.
 */
const IdentityPanel = ({ profile, canEditPin }: { profile: ProfileDto; canEditPin: boolean }) => {
  const { t } = useTranslation()
  const id = useId()
  const update = useUpdateProfile()
  const [name, setName] = useState(profile.name)
  const [color, setColor] = useState<AvatarColor>(profile.avatarColor)
  const [pinOn, setPinOn] = useState(profile.hasPin)
  const [changingPin, setChangingPin] = useState(false)
  const [pin, setPin] = useState('')

  const nameValid = profileNameSchema.safeParse(name).success
  const needsNewPin = canEditPin && pinOn && (!profile.hasPin || changingPin)
  const pinValid = !needsNewPin || pinSchema.safeParse(pin).success
  const removesPin = canEditPin && profile.hasPin && !pinOn
  const dirty =
    name.trim() !== profile.name || color !== profile.avatarColor || needsNewPin || removesPin
  const ready = dirty && nameValid && pinValid

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready || update.isPending) return
    const body: UpdateProfileBody = {
      ...(name.trim() === profile.name ? {} : { name: name.trim() }),
      ...(color === profile.avatarColor ? {} : { avatarColor: color }),
      ...(needsNewPin ? { pin } : removesPin ? { pin: '' } : {}),
    }
    update.mutate(
      { id: profile.id, body },
      {
        onSuccess: () => {
          setName(name.trim())
          setPin('')
          setChangingPin(false)
        },
      },
    )
  }

  return (
    <Panel title={t('profiles.settings.profile')}>
      <form className="settings-panel__form" onSubmit={submit} noValidate>
        {update.isError ? <ErrorAlert error={update.error} /> : undefined}
        <Field
          id={`${id}-name`}
          label={t('profiles.editor.name')}
          invalid={name.length > 0 && !nameValid}
        >
          <input
            id={`${id}-name`}
            className="field__input"
            maxLength={32}
            autoComplete="off"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <ColorSwatches value={color} onChange={setColor} />
        {canEditPin ? (
          <PinFields
            hasPin={profile.hasPin}
            on={pinOn}
            changing={changingPin}
            pin={pin}
            valid={pinValid}
            needsNewPin={needsNewPin}
            onToggle={(value) => {
              setPinOn(value)
              setPin('')
            }}
            onChange={setPin}
            onChanging={() => setChangingPin(true)}
          />
        ) : undefined}
        <div className="settings-panel__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={!ready || update.isPending}
          >
            {update.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('common.save')}
          </button>
        </div>
      </form>
    </Panel>
  )
}

/**
 * Profile settings (§11.1, §12.4, §14): interface language, audio and subtitle languages,
 * subtitle mode, anime in original version, autoplay, skipping intros and credits. Every change
 * is saved at once. Library access and maximum rating are the admin's: shown, not editable.
 */
const ProfileSettings = ({ profile }: { profile: ProfileDto }) => {
  const { t } = useTranslation()
  const ids = useId()
  const locale = currentLocale()
  const update = useUpdateProfile()
  const pending = update.isPending ? update.variables.body : {}
  const value = <K extends keyof Editable>(key: K): ProfileDto[K] =>
    (key in pending ? pending[key] : profile[key]) as ProfileDto[K]
  const save = (body: Editable) => update.mutate({ id: profile.id, body })
  const languageOptions = (current: string) =>
    [...new Set([current, ...trackLanguages])].map((code) => ({
      code,
      label: languageName(code, locale) ?? code,
    }))

  return (
    <div className="page page--narrow settings">
      <div className="settings__head">
        <BackLink className="page__back" label={t('common.back')}>
          <ChevronLeftIcon size={18} />
        </BackLink>
        <Avatar name={profile.name} color={profile.avatarColor} size="xlarge" />
        <div className="settings__who">
          <h1 className="page__title">{profile.name}</h1>
        </div>
      </div>
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}

      <IdentityPanel
        profile={profile}
        canEditPin={profile.libraryAccess === 'all' && profile.maxContentRating === undefined}
      />

      <Panel title={t('profiles.settings.language')}>
        <div className="setting">
          <div className="setting__text">
            <span id={`${ids}-ui`} className="setting__label">
              {t('profiles.settings.uiLocale')}
            </span>
          </div>
          <div
            className="seg"
            role="radiogroup"
            aria-labelledby={`${ids}-ui`}
            data-active={locales.indexOf(value('uiLocale'))}
          >
            <span className="seg__indicator" aria-hidden="true" />
            {locales.map((code) => (
              <button
                key={code}
                type="button"
                role="radio"
                className="seg__option"
                aria-checked={value('uiLocale') === code}
                onClick={() => save({ uiLocale: code })}
              >
                {languageName(code, code)}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title={t('profiles.settings.tracks')}>
        <div className="settings-panel__fields">
          <Field
            id={`${ids}-audio`}
            label={t('profiles.settings.audioLanguage')}
            trail={<SelectChevron />}
          >
            <select
              id={`${ids}-audio`}
              className="field__input"
              value={value('audioLanguage')}
              onChange={(event) => save({ audioLanguage: event.target.value })}
            >
              {languageOptions(value('audioLanguage')).map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={`${ids}-subtitles`}
            label={t('profiles.settings.subtitleLanguage')}
            trail={<SelectChevron />}
          >
            <select
              id={`${ids}-subtitles`}
              className="field__input"
              value={value('subtitleLanguage')}
              onChange={(event) => save({ subtitleLanguage: event.target.value })}
            >
              {languageOptions(value('subtitleLanguage')).map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={`${ids}-mode`}
            label={t('profiles.settings.subtitleMode')}
            trail={<SelectChevron />}
          >
            <select
              id={`${ids}-mode`}
              className="field__input"
              value={value('subtitleMode')}
              onChange={(event) =>
                save({ subtitleMode: subtitleModeSchema.parse(event.target.value) as SubtitleMode })
              }
            >
              {subtitleModeSchema.options.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`profiles.settings.subtitleModes.${mode}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <SwitchSetting
          label={t('profiles.settings.animeOriginalAudio')}
          description={t('profiles.settings.animeOriginalAudioText')}
          checked={value('animeOriginalAudio')}
          onChange={(checked) => save({ animeOriginalAudio: checked })}
        />
      </Panel>

      <Panel title={t('profiles.settings.playback')}>
        <SwitchSetting
          label={t('profiles.settings.autoplayNext')}
          checked={value('autoplayNext')}
          onChange={(checked) => save({ autoplayNext: checked })}
        />
        <SwitchSetting
          label={t('profiles.settings.autoSkipIntro')}
          checked={value('autoSkipIntro')}
          onChange={(checked) => save({ autoSkipIntro: checked })}
        />
        <SwitchSetting
          label={t('profiles.settings.autoSkipCredits')}
          checked={value('autoSkipCredits')}
          onChange={(checked) => save({ autoSkipCredits: checked })}
        />
      </Panel>

      <Panel title={t('profiles.settings.access')}>
        <dl className="settings-facts">
          <div className="settings-facts__row">
            <dt>{t('profiles.settings.libraries')}</dt>
            <dd>
              {profile.libraryAccess === 'all'
                ? t('profiles.settings.allLibraries')
                : t('profiles.settings.someLibraries', { count: profile.libraryIds.length })}
            </dd>
          </div>
          <div className="settings-facts__row">
            <dt>{t('profiles.settings.maxRating')}</dt>
            <dd>
              {profile.maxContentRating === undefined
                ? t('profiles.settings.noLimit')
                : t(`profiles.settings.ratingTiers.${profile.maxContentRating}`)}
            </dd>
          </div>
        </dl>
        <p className="setting__description">{t('profiles.settings.accessByAdmin')}</p>
      </Panel>
    </div>
  )
}

/** `/settings/profile`: settings of the active profile. */
export const ProfileSettingsPage = () => {
  const { t } = useTranslation()
  const session = useQuery(sessionQuery)
  const me = session.data?.status === 'signed_in' ? session.data.me : undefined
  const profile = me === undefined ? undefined : pickActiveProfile(me)
  if (me === undefined || profile === undefined)
    return (
      <div className="page">
        <EmptyState
          title={t('profiles.settings.noProfile')}
          action={
            <Link to="/profiles" className="button button--glass">
              {t('shell.switchProfile')}
            </Link>
          }
        />
      </div>
    )
  return <ProfileSettings key={profile.id} profile={profile} />
}
