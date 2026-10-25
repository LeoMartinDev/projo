import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SegmentProviderIdDto, SegmentSettingsDto } from '@projo/shared/api/segments'

import { Field, Switch } from '../../../shared/ui/controls.tsx'
import { ChevronDownIcon, ChevronUpIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import {
  changedThresholds,
  checkThresholds,
  thresholdBounds,
  thresholdFields,
  thresholdsDraftOf,
} from './fingerprint.ts'
import { moveProvider, providerRows, setProviderEnabled } from './providers.ts'
import { ApiKeySetting } from './ApiKeySetting.tsx'
import { useUpdateSettings } from './queries.ts'

const providerNames: Record<SegmentProviderIdDto, string> = {
  theintrodb: 'TheIntroDB',
  introdb: 'IntroDB',
  skipdb: 'SkipDB',
}

/** Providers asked in order (§12.2): a table, reorder with the arrows, a switch per provider. */
const Providers = ({ enabled }: { enabled: readonly SegmentProviderIdDto[] }) => {
  const { t } = useTranslation()
  const id = useId()
  const update = useUpdateSettings()
  const save = (providers: SegmentProviderIdDto[]) => update.mutate({ segments: { providers } })
  return (
    <div className="settings-block">
      <div
        className="seg-providers"
        role="table"
        aria-label={t('admin.settings.segments.providers')}
      >
        <div className="seg-providers__row seg-providers__row--head" role="row">
          <span role="columnheader">{t('admin.settings.segments.provider')}</span>
          <span role="columnheader">{t('admin.settings.segments.order')}</span>
          <span role="columnheader" className="seg-providers__end">
            {t('admin.settings.segments.enabled')}
          </span>
        </div>
        {providerRows(enabled).map((row, index) => (
          <div key={row.id} className="seg-providers__row" role="row" data-enabled={row.enabled}>
            <span role="cell" id={`${id}-${row.id}`} className="seg-providers__name">
              <span className="seg-providers__rank" aria-hidden="true">
                {row.enabled ? index + 1 : '–'}
              </span>
              {providerNames[row.id]}
            </span>
            <span role="cell" className="seg-providers__move">
              <button
                type="button"
                className="icon-button"
                aria-label={t('admin.settings.segments.moveUp', { name: providerNames[row.id] })}
                disabled={!row.enabled || index === 0 || update.isPending}
                onClick={() => save(moveProvider(enabled, row.id, -1))}
              >
                <ChevronUpIcon />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('admin.settings.segments.moveDown', { name: providerNames[row.id] })}
                disabled={!row.enabled || index === enabled.length - 1 || update.isPending}
                onClick={() => save(moveProvider(enabled, row.id, 1))}
              >
                <ChevronDownIcon />
              </button>
            </span>
            <span role="cell" className="seg-providers__end">
              <Switch
                checked={row.enabled}
                labelId={`${id}-${row.id}`}
                onChange={(on) => {
                  if (!update.isPending) save(setProviderEnabled(enabled, row.id, on))
                }}
              />
            </span>
          </div>
        ))}
      </div>
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
    </div>
  )
}

const thresholdLabelKeys = {
  introMinutes: 'admin.settings.segments.introMinutes',
  creditsMinutes: 'admin.settings.segments.creditsMinutes',
  minSeconds: 'admin.settings.segments.minSeconds',
  maxSeconds: 'admin.settings.segments.maxSeconds',
  similarity: 'admin.settings.segments.similarity',
} as const

/** Fingerprinting (§12.3): on/off saved at once, the thresholds with "Enregistrer". */
const Fingerprint = ({ fingerprint }: { fingerprint: SegmentSettingsDto['fingerprint'] }) => {
  const { t } = useTranslation()
  const id = useId()
  const toggle = useUpdateSettings()
  const update = useUpdateSettings()
  const { enabled, ...stored } = fingerprint
  const [draft, setDraft] = useState(() => thresholdsDraftOf(stored))
  const checked = checkThresholds(draft)
  const changes = checked.ok ? changedThresholds(stored, checked.value) : {}
  const dirty = Object.keys(changes).length > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || update.isPending) return
    update.mutate({ segments: { fingerprint: changes } })
  }

  return (
    <div className="settings-block">
      <div className="setting">
        <span id={`${id}-enabled`} className="setting__label">
          {t('admin.settings.segments.fingerprint')}
        </span>
        <Switch
          checked={enabled}
          labelId={`${id}-enabled`}
          onChange={(on) => {
            if (!toggle.isPending) toggle.mutate({ segments: { fingerprint: { enabled: on } } })
          }}
        />
      </div>
      {toggle.isError ? <ErrorAlert error={toggle.error} /> : undefined}
      <form className="seg-thresholds" onSubmit={submit} noValidate data-disabled={!enabled}>
        {thresholdFields.map((field) => {
          const invalid = !checked.ok && checked.invalid.includes(field)
          const { min, max } = thresholdBounds[field]
          return (
            <Field
              key={field}
              id={`${id}-${field}`}
              label={t(thresholdLabelKeys[field])}
              invalid={invalid}
            >
              <input
                id={`${id}-${field}`}
                className="field__input"
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                value={draft[field]}
                aria-invalid={invalid}
                onChange={(event) => {
                  setDraft({ ...draft, [field]: event.target.value })
                  if (update.isError || update.isSuccess) update.reset()
                }}
              />
            </Field>
          )
        })}
        <div className="seg-thresholds__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={!dirty || update.isPending}
          >
            {update.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('common.save')}
          </button>
        </div>
      </form>
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
    </div>
  )
}

/** Contribution (§12.5): manual markers sent to TheIntroDB and SkipDB, needs a TheIntroDB key. */
const Contribution = ({
  contribution,
  keyConfigured,
}: {
  contribution: SegmentSettingsDto['contribution']
  keyConfigured: boolean
}) => {
  const { t } = useTranslation()
  const id = useId()
  const update = useUpdateSettings()
  const on = contribution === 'manual_only'
  return (
    <div className="settings-block">
      <div className="setting">
        <span className="setting__text">
          <span id={`${id}-label`} className="setting__label">
            {t('admin.settings.segments.contribution')}
          </span>
          {keyConfigured ? undefined : (
            <span className="setting__description">
              {t('admin.settings.segments.contributionNeedsKey')}
            </span>
          )}
        </span>
        <Switch
          checked={on}
          labelId={`${id}-label`}
          disabled={!keyConfigured && !on}
          onChange={(next) => {
            if (update.isPending || (next && !keyConfigured)) return
            update.mutate({ segments: { contribution: next ? 'manual_only' : 'off' } })
          }}
        />
      </div>
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
    </div>
  )
}

/** `/admin/settings` "Intros and credits" (§15): providers and order, TheIntroDB key, fingerprinting, contribution. */
export const SegmentSettings = ({ segments }: { segments: SegmentSettingsDto }) => {
  const { t } = useTranslation()
  const key = segments.theintrodbApiKey
  return (
    <>
      <Providers enabled={segments.providers} />
      <ApiKeySetting
        label={t('admin.settings.segments.theintrodbKey')}
        status={{
          configured: key.configured,
          ...(key.last4 === undefined ? {} : { last4: key.last4 }),
        }}
        minLength={8}
        toBody={(theintrodbApiKey) => ({ segments: { theintrodbApiKey } })}
        removeTitle={t('admin.settings.segments.removeKeyTitle')}
        removeText={t('admin.settings.segments.removeKeyText')}
      />
      <Fingerprint
        key={JSON.stringify({ ...segments.fingerprint, enabled: undefined })}
        fingerprint={segments.fingerprint}
      />
      <Contribution contribution={segments.contribution} keyConfigured={key.configured} />
    </>
  )
}
