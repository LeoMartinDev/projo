import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'
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
import { Field } from '../../shared/ui/controls.tsx'
import { SelectField } from '../../shared/ui/Select.tsx'
import { EmptyState, ErrorAlert } from '../../shared/ui/states.tsx'
import { Segmented } from '../../shared/ui/Segmented.tsx'
import { SettingsPanel } from '../../shared/ui/SettingsPanel.tsx'
import { SettingsPage } from '../../shared/ui/SettingsPage.tsx'
import { Setting, SwitchSetting } from '../../shared/ui/Setting.tsx'
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
    <SettingsPanel title={t('profiles.settings.profile')}>
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
    </SettingsPanel>
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
    <SettingsPage
      title={profile.name}
      leading={<Avatar name={profile.name} color={profile.avatarColor} size="xlarge" />}
    >
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}

      <IdentityPanel
        profile={profile}
        canEditPin={profile.libraryAccess === 'all' && profile.maxContentRating === undefined}
      />

      <SettingsPanel title={t('profiles.settings.language')}>
        <Setting label={t('profiles.settings.uiLocale')} labelId={`${ids}-ui`}>
          <Segmented
            labelledBy={`${ids}-ui`}
            options={locales.map((code) => ({
              value: code,
              label: languageName(code, code) ?? code,
            }))}
            value={value('uiLocale')}
            onChange={(uiLocale) => save({ uiLocale })}
          />
        </Setting>
      </SettingsPanel>

      <SettingsPanel title={t('profiles.settings.tracks')}>
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
      </SettingsPanel>

      <SettingsPanel title={t('profiles.settings.playback')}>
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
      </SettingsPanel>

      <SettingsPanel title={t('profiles.settings.access')}>
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
      </SettingsPanel>
    </SettingsPage>
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
