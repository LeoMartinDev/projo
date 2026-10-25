import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LibraryDto, LibraryHint } from '@projo/shared/api/libraries'

import { api, request } from '../../shared/api/client.ts'
import { formatNumber } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Field, SelectChevron, Switch } from '../../shared/ui/controls.tsx'
import { CheckIcon, CloseIcon, FolderIcon, PlusIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { FolderBrowser } from './FolderBrowser.tsx'
import { nameFromFolder, parentOf } from './folder-paths.ts'
import { countryLabel, languageLabel, metadataLanguages, ratingCountries } from './languages.ts'
import { accountsQueryKey } from './accounts/queries.ts'
import { LibraryProfiles, useLibraryProfiles } from './LibraryProfiles.tsx'
import { rootErrorLabel } from './library-status.tsx'
import { librariesQueryKey } from './queries.ts'
import './admin.css'

const hints: readonly LibraryHint[] = ['auto', 'movies', 'series']

type Toggle = 'watchEnabled' | 'detectSegments' | 'trickplayEnabled' | 'preExtractSubtitles'
const toggles: readonly Toggle[] = [
  'watchEnabled',
  'detectSegments',
  'trickplayEnabled',
  'preExtractSubtitles',
]

/**
 * Library creation and edition (§15, artboard `AdminAddLibrary`, kit v2 controls): content type,
 * name, folders picked with the explorer, metadata language and rating country, scan options,
 * profiles with access (§14).
 * The first launch has its own step, folders and name only (`features/setup/LibraryStep`).
 */
export const LibraryForm = ({
  library,
  submitLabel,
  cancel,
  onSaved,
}: {
  library?: LibraryDto
  submitLabel: string
  cancel: ReactNode
  onSaved: (library: LibraryDto) => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queryClient = useQueryClient()
  const formId = useId()
  const [name, setName] = useState(library?.name ?? '')
  const [hint, setHint] = useState<LibraryHint>(library?.hint ?? 'auto')
  const [roots, setRoots] = useState<string[]>(library?.roots.map((root) => root.path) ?? [])
  const [metadataLanguage, setMetadataLanguage] = useState(library?.metadataLanguage ?? '')
  const [ratingCountry, setRatingCountry] = useState(library?.ratingCountry ?? 'FR')
  const [options, setOptions] = useState<Record<Toggle, boolean>>({
    watchEnabled: library?.watchEnabled ?? true,
    detectSegments: library?.detectSegments ?? true,
    trickplayEnabled: library?.trickplayEnabled ?? true,
    preExtractSubtitles: library?.preExtractSubtitles ?? false,
  })
  const [scanIntervalMinutes, setScanIntervalMinutes] = useState(library?.scanIntervalMinutes ?? 15)
  const [quietPeriodSeconds, setQuietPeriodSeconds] = useState(library?.quietPeriodSeconds ?? 120)
  const access = useLibraryProfiles(library?.id)
  /** Set once the admin touches a switch; until then, what the server says. */
  const [profileChoice, setProfileChoice] = useState<ReadonlySet<string>>()
  const selectedProfiles = profileChoice ?? access.initial ?? new Set<string>()
  const [browserOpen, setBrowserOpen] = useState(false)
  const [touched, setTouched] = useState(false)

  const nameValid = name.trim().length > 0
  const rootsValid = roots.length > 0
  const numbersValid =
    Number.isInteger(scanIntervalMinutes) &&
    scanIntervalMinutes >= 1 &&
    scanIntervalMinutes <= 10_080 &&
    Number.isInteger(quietPeriodSeconds) &&
    quietPeriodSeconds >= 0 &&
    quietPeriodSeconds <= 86_400

  const saveLibrary = () => {
    const common = {
      name: name.trim(),
      roots,
      hint,
      ratingCountry,
      scanIntervalMinutes,
      quietPeriodSeconds,
      ...options,
    }
    return library === undefined
      ? request(() =>
          api.admin.libraries.$post({
            json: {
              ...common,
              ...(metadataLanguage === '' ? {} : { metadataLanguage }),
            },
          }),
        )
      : request(() =>
          api.admin.libraries[':id'].$patch({
            param: { id: library.id },
            json: { ...common, metadataLanguage },
          }),
        )
  }

  const save = useMutation({
    mutationFn: async () => {
      const saved = await saveLibrary()
      if (profileChoice !== undefined) {
        await request(() =>
          api.admin.libraries[':id'].profiles.$put({
            param: { id: saved.id },
            json: { profileIds: [...profileChoice] },
          }),
        )
      }
      return saved
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: librariesQueryKey })
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      onSaved(saved)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (nameValid && rootsValid && numbersValid && !save.isPending) save.mutate()
  }

  const addRoot = (path: string) => {
    setBrowserOpen(false)
    if (roots.includes(path)) return
    setRoots([...roots, path])
    if (name.trim().length === 0) setName(nameFromFolder(path, locale))
  }

  const rootInfo = (path: string) => library?.roots.find((root) => root.path === path)
  const lastRoot = roots[roots.length - 1]

  return (
    <>
      <form className="library-form" onSubmit={submit} noValidate>
        {save.isError ? <ErrorAlert error={save.error} /> : undefined}

        <fieldset className="library-form__section library-form__section--first">
          <legend className="library-form__legend">{t('admin.form.contentType')}</legend>
          <div className="choices" role="radiogroup" aria-label={t('admin.form.contentType')}>
            {hints.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                className="choice"
                aria-checked={hint === value}
                onClick={() => setHint(value)}
              >
                <span className="choice__label">{t(`admin.hint.${value}`)}</span>
                <span className="choice__text">{t(`admin.hintDescription.${value}`)}</span>
                <span className="choice__badge" aria-hidden="true">
                  <CheckIcon size={13} stroke={3} />
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="library-form__section">
          <div className="form-row">
            <Field
              id={`${formId}-name`}
              label={t('admin.form.name')}
              invalid={touched && !nameValid}
            >
              <input
                id={`${formId}-name`}
                className="field__input"
                value={name}
                maxLength={100}
                aria-invalid={touched && !nameValid}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {touched && !nameValid ? (
              <span className="hint hint--error">{t('admin.form.nameRequired')}</span>
            ) : undefined}
          </div>

          <div className="form-row">
            <span id={`${formId}-folders`} className="library-form__label">
              {t('admin.form.folders')}
            </span>
            {roots.length > 0 ? (
              <ul className="root-list well" aria-labelledby={`${formId}-folders`}>
                {roots.map((path) => {
                  const info = rootInfo(path)
                  return (
                    <li key={path} className="root-item">
                      <FolderIcon size={16} />
                      <span className="root-item__path mono" title={path}>
                        <bdi>{path}</bdi>
                      </span>
                      {info === undefined ? undefined : (
                        <span className="root-item__meta">
                          {info.state === 'unreachable'
                            ? rootErrorLabel(t, info.lastError)
                            : t('admin.root.files', {
                                count: info.lastFileCount,
                                formatted: formatNumber(info.lastFileCount, locale),
                              })}
                        </span>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t('admin.form.removeFolder', { path })}
                        onClick={() => setRoots(roots.filter((root) => root !== path))}
                      >
                        <CloseIcon size={16} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : undefined}
            <button
              type="button"
              className="button button--glass button--small add-folder"
              onClick={() => setBrowserOpen(true)}
            >
              <PlusIcon size={16} />
              {t('admin.form.addFolder')}
            </button>
            {touched && !rootsValid ? (
              <span className="hint hint--error">{t('admin.form.foldersRequired')}</span>
            ) : undefined}
          </div>
        </div>

        <AdvancedSettings
          formId={formId}
          touched={touched}
          numbersValid={numbersValid}
          metadataLanguage={[metadataLanguage, setMetadataLanguage]}
          ratingCountry={[ratingCountry, setRatingCountry]}
          options={[options, setOptions]}
          scanIntervalMinutes={[scanIntervalMinutes, setScanIntervalMinutes]}
          quietPeriodSeconds={[quietPeriodSeconds, setQuietPeriodSeconds]}
        />

        <LibraryProfiles
          formId={formId}
          rows={access.rows}
          error={access.error}
          selected={selectedProfiles}
          onChange={setProfileChoice}
        />

        <div className="library-form__actions">
          {cancel}
          <button type="submit" className="button button--primary" disabled={save.isPending}>
            {save.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {submitLabel}
          </button>
        </div>
      </form>

      {browserOpen ? (
        <FolderBrowser
          open
          initialPath={lastRoot === undefined ? '/' : parentOf(lastRoot)}
          onClose={() => setBrowserOpen(false)}
          onPick={addRoot}
        />
      ) : undefined}
    </>
  )
}

type Field<T> = readonly [T, (value: T) => void]

const AdvancedSettings = ({
  formId,
  touched,
  numbersValid,
  metadataLanguage: [metadataLanguage, setMetadataLanguage],
  ratingCountry: [ratingCountry, setRatingCountry],
  options: [options, setOptions],
  scanIntervalMinutes: [scanIntervalMinutes, setScanIntervalMinutes],
  quietPeriodSeconds: [quietPeriodSeconds, setQuietPeriodSeconds],
}: {
  formId: string
  touched: boolean
  numbersValid: boolean
  metadataLanguage: Field<string>
  ratingCountry: Field<string>
  options: Field<Record<Toggle, boolean>>
  scanIntervalMinutes: Field<number>
  quietPeriodSeconds: Field<number>
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  return (
    <>
      <div className="library-form__section library-form__grid">
        <Field
          id={`${formId}-language`}
          label={t('admin.form.metadataLanguage')}
          trail={<SelectChevron />}
        >
          <select
            id={`${formId}-language`}
            className="field__input"
            value={metadataLanguage}
            onChange={(event) => setMetadataLanguage(event.target.value)}
          >
            <option value="">{t('admin.form.serverDefault')}</option>
            {metadataLanguages.map((code) => (
              <option key={code} value={code}>
                {languageLabel(code, locale)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id={`${formId}-country`}
          label={t('admin.form.ratingCountry')}
          trail={<SelectChevron />}
        >
          <select
            id={`${formId}-country`}
            className="field__input"
            value={ratingCountry}
            onChange={(event) => setRatingCountry(event.target.value)}
          >
            {ratingCountries.map((code) => (
              <option key={code} value={code}>
                {countryLabel(code, locale)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="library-form__section library-form__options">
        {toggles.map((key) => (
          <div key={key} className="setting">
            <div className="setting__text">
              <span id={`${formId}-${key}`} className="setting__label">
                {t(`admin.options.${key}`)}
              </span>
              <span className="setting__description">{t(`admin.optionsDescription.${key}`)}</span>
            </div>
            <Switch
              checked={options[key]}
              labelId={`${formId}-${key}`}
              onChange={(value) => setOptions({ ...options, [key]: value })}
            />
          </div>
        ))}
      </div>

      <div className="library-form__section library-form__grid">
        <Field
          id={`${formId}-interval`}
          label={t('admin.form.scanInterval')}
          invalid={touched && !numbersValid}
        >
          <input
            id={`${formId}-interval`}
            className="field__input"
            type="number"
            inputMode="numeric"
            min={1}
            max={10_080}
            value={Number.isNaN(scanIntervalMinutes) ? '' : scanIntervalMinutes}
            aria-invalid={touched && !numbersValid}
            onChange={(event) => setScanIntervalMinutes(event.target.valueAsNumber)}
          />
        </Field>
        <Field
          id={`${formId}-quiet`}
          label={t('admin.form.quietPeriod')}
          invalid={touched && !numbersValid}
        >
          <input
            id={`${formId}-quiet`}
            className="field__input"
            type="number"
            inputMode="numeric"
            min={0}
            max={86_400}
            value={Number.isNaN(quietPeriodSeconds) ? '' : quietPeriodSeconds}
            aria-invalid={touched && !numbersValid}
            onChange={(event) => setQuietPeriodSeconds(event.target.valueAsNumber)}
          />
        </Field>
      </div>
    </>
  )
}
