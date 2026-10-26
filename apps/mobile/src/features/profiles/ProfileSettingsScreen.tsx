import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, StyleSheet, View } from 'react-native'

import {
  type ProfileDto,
  subtitleModeSchema,
  uiLocaleSchema,
  type UpdateProfileBody,
} from '@projo/shared/api/profiles'

import { toFailure } from '../../shared/api/failure.ts'
import { errorKey } from '../../shared/i18n/errors.ts'
import { languageName } from '../../shared/i18n/intl.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { type Option, OptionsSheet } from '../../shared/ui/OptionsSheet.tsx'
import { Row, Section, SettingsPage, SwitchRow } from '../../shared/ui/Settings.tsx'
import { useSession } from '../session/Session.tsx'
import { IdentityFields, useIdentityDraft } from './IdentityFields.tsx'
import { useUpdateProfile } from './queries.ts'

/** Languages offered for audio and subtitles (§11.1), ISO 639-1: the web's list. */
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

type Editable = Omit<UpdateProfileBody, 'currentPin' | 'pin' | 'libraryIds' | 'libraryAccess'>
type Picker = 'uiLocale' | 'audioLanguage' | 'subtitleLanguage' | 'subtitleMode'

/**
 * Name, colour and PIN (§13.6), saved with one button; a restricted profile does not set or
 * remove a PIN (§14).
 */
const IdentitySection = ({ profile }: { profile: ProfileDto }) => {
  const { t } = useTranslation()
  const update = useUpdateProfile()
  const draft = useIdentityDraft(profile)
  const canEditPin = profile.libraryAccess === 'all' && profile.maxContentRating === undefined
  const changes = draft.changes(profile)
  const ready = Object.keys(changes).length > 0 && draft.valid
  const error = update.error ?? undefined

  return (
    <Section title={t('profiles.settings.profile')}>
      <View style={styles.identity}>
        <IdentityFields canEditPin={canEditPin} draft={draft} hasPin={profile.hasPin} />
        <ErrorLine error={error === undefined ? undefined : toFailure(error)} />
        <Button
          busy={update.isPending}
          disabled={!ready}
          label={t('common.save')}
          onPress={() =>
            update.mutate({ id: profile.id, body: changes }, { onSuccess: draft.reset })
          }
        />
      </View>
    </Section>
  )
}

/**
 * Settings of the active profile, as on the web (§11.1, §12.4, §14): identity, interface language,
 * audio and subtitles, playback; every setting is saved at once. Library access and maximum rating
 * are the admin's: shown, not editable.
 */
const ProfileSettings = ({ profile }: { profile: ProfileDto }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const update = useUpdateProfile()
  // The last picker stays filled while its sheet slides away.
  const [picking, setPicking] = useState<Picker>('uiLocale')
  const [pickerOpen, setPickerOpen] = useState(false)
  const pick = (picker: Picker) => {
    setPicking(picker)
    setPickerOpen(true)
  }
  // While a change is saved, it already shows.
  const pending: Editable = update.isPending ? update.variables.body : {}
  const value = <K extends keyof Editable>(key: K): ProfileDto[K] =>
    (key in pending ? pending[key] : profile[key]) as ProfileDto[K]
  // Saved at once, like the web: a refused change says so, and the setting shows its saved value.
  const save = (body: Editable) =>
    update.mutate(
      { id: profile.id, body },
      {
        onError: (error) => Alert.alert(t('common.errorTitle'), t(errorKey(toFailure(error).code))),
      },
    )

  const languages = (current: string): Option<string>[] =>
    [...new Set([current, ...trackLanguages])].map((code) => ({
      value: code,
      label: languageName(code, locale),
    }))
  const pickers: Record<Picker, { title: string; options: readonly Option<string>[] }> = {
    uiLocale: {
      title: t('profiles.settings.uiLocale'),
      options: uiLocaleSchema.options.map((code) => ({
        value: code,
        label: languageName(code, code),
      })),
    },
    audioLanguage: {
      title: t('profiles.settings.audioLanguage'),
      options: languages(value('audioLanguage')),
    },
    subtitleLanguage: {
      title: t('profiles.settings.subtitleLanguage'),
      options: languages(value('subtitleLanguage')),
    },
    subtitleMode: {
      title: t('profiles.settings.subtitleMode'),
      options: subtitleModeSchema.options.map((mode) => ({
        value: mode,
        label: t(`profiles.settings.subtitleModes.${mode}`),
      })),
    },
  }
  const choose = (picker: Picker, chosen: string) => {
    if (picker === 'uiLocale') save({ uiLocale: uiLocaleSchema.parse(chosen) })
    else if (picker === 'subtitleMode') save({ subtitleMode: subtitleModeSchema.parse(chosen) })
    else save({ [picker]: chosen })
  }

  return (
    <SettingsPage>
      <IdentitySection profile={profile} />

      <Section title={t('profiles.settings.language')}>
        <Row
          label={t('profiles.settings.uiLocale')}
          onPress={() => pick('uiLocale')}
          value={languageName(value('uiLocale'), value('uiLocale'))}
        />
      </Section>

      <Section title={t('profiles.settings.tracks')}>
        <Row
          label={t('profiles.settings.audioLanguage')}
          onPress={() => pick('audioLanguage')}
          value={languageName(value('audioLanguage'), locale)}
        />
        <Row
          label={t('profiles.settings.subtitleLanguage')}
          onPress={() => pick('subtitleLanguage')}
          value={languageName(value('subtitleLanguage'), locale)}
        />
        <Row
          label={t('profiles.settings.subtitleMode')}
          onPress={() => pick('subtitleMode')}
          value={t(`profiles.settings.subtitleModes.${value('subtitleMode')}`)}
        />
        <SwitchRow
          description={t('profiles.settings.animeOriginalAudioText')}
          label={t('profiles.settings.animeOriginalAudio')}
          onChange={(checked) => save({ animeOriginalAudio: checked })}
          value={value('animeOriginalAudio')}
        />
      </Section>

      <Section title={t('profiles.settings.playback')}>
        <SwitchRow
          label={t('profiles.settings.autoplayNext')}
          onChange={(checked) => save({ autoplayNext: checked })}
          value={value('autoplayNext')}
        />
        <SwitchRow
          label={t('profiles.settings.autoSkipIntro')}
          onChange={(checked) => save({ autoSkipIntro: checked })}
          value={value('autoSkipIntro')}
        />
        <SwitchRow
          label={t('profiles.settings.autoSkipCredits')}
          onChange={(checked) => save({ autoSkipCredits: checked })}
          value={value('autoSkipCredits')}
        />
      </Section>

      <Section footer={t('profiles.settings.accessByAdmin')} title={t('profiles.settings.access')}>
        <Row
          label={t('profiles.settings.libraries')}
          value={
            profile.libraryAccess === 'all'
              ? t('profiles.settings.allLibraries')
              : t('profiles.settings.someLibraries', { count: profile.libraryIds.length })
          }
        />
        <Row
          label={t('profiles.settings.maxRating')}
          value={
            profile.maxContentRating === undefined
              ? t('profiles.settings.noLimit')
              : t(`profiles.settings.ratingTiers.${profile.maxContentRating}`)
          }
        />
      </Section>

      <OptionsSheet
        onClose={() => setPickerOpen(false)}
        onSelect={(chosen) => choose(picking, chosen)}
        open={pickerOpen}
        options={pickers[picking].options}
        title={pickers[picking].title}
        value={value(picking)}
      />
    </SettingsPage>
  )
}

/** `/settings/profile`: the active profile's settings. */
export const ProfileSettingsScreen = () => {
  const { gate } = useSession()
  if (gate.kind !== 'ready') return undefined
  return <ProfileSettings key={gate.profile.id} profile={gate.profile} />
}

const styles = StyleSheet.create({ identity: { gap: 14, padding: 16 } })
