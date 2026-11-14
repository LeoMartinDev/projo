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
import { Field, Switch } from '../../shared/ui/controls.tsx'
import { SelectField } from '../../shared/ui/Select.tsx'
import { ChevronLeftIcon } from '../../shared/ui/media-icons.tsx'
import { EmptyState, ErrorAlert } from '../../shared/ui/states.tsx'
import { languageName } from '../item/media-labels.ts'
import { Avatar } from '../shell/Avatar.tsx'
import { ColorSwatches, PinFields } from './IdentityFields.tsx'
import { useUpdateProfile } from './queries.ts'
import './profiles.css'

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
      value: code,
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
          <SelectField
            id={`${ids}-audio`}
            label={t('profiles.settings.audioLanguage')}
            value={value('audioLanguage')}
            options={languageOptions(value('audioLanguage'))}
            onChange={(audioLanguage) => save({ audioLanguage })}
          />
          <SelectField
            id={`${ids}-subtitles`}
            label={t('profiles.settings.subtitleLanguage')}
            value={value('subtitleLanguage')}
            options={languageOptions(value('subtitleLanguage'))}
            onChange={(subtitleLanguage) => save({ subtitleLanguage })}
          />
          <SelectField<SubtitleMode>
            id={`${ids}-mode`}
            label={t('profiles.settings.subtitleMode')}
            value={value('subtitleMode')}
            options={subtitleModeSchema.options.map((mode) => ({
              value: mode,
              label: t(`profiles.settings.subtitleModes.${mode}`),
            }))}
            onChange={(subtitleMode) => save({ subtitleMode })}
          />
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
