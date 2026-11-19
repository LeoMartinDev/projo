import { type FormEvent, useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { SegmentProviderIdDto, SegmentSettingsDto } from '@projo/shared/api/segments'

import { Field, Switch } from '../../../shared/ui/controls.tsx'
import { ChevronDownIcon, ChevronUpIcon } from '../../../shared/ui/icons.tsx'
import { SwitchSetting } from '../../../shared/ui/Setting.tsx'
import { ApiKeySetting } from './ApiKeySetting.tsx'
import { thresholdBounds, thresholdFields } from './fingerprint.ts'
import { moveProvider, providerRows, setProviderEnabled } from './providers.ts'
import { SaveBar } from './SaveBar.tsx'
import { segmentsChanges, type SegmentsDraft, segmentsDraftOf } from './segments-form.ts'
import { type SettingsForm, useSettingsForm } from './use-settings-form.ts'

const providerNames: Record<SegmentProviderIdDto, string> = {
  theintrodb: 'TheIntroDB',
  introdb: 'IntroDB',
  skipdb: 'SkipDB',
}

type Form = SettingsForm<SegmentsDraft>

const Providers = ({ form }: { form: Form }) => {
  const { t } = useTranslation()
  const id = useId()
  const enabled = form.draft.providers
  const set = (providers: SegmentProviderIdDto[]) => form.set('providers', providers)
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
                disabled={!row.enabled || index === 0}
                onClick={() => set(moveProvider(enabled, row.id, -1))}
              >
                <ChevronUpIcon />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('admin.settings.segments.moveDown', { name: providerNames[row.id] })}
                disabled={!row.enabled || index === enabled.length - 1}
                onClick={() => set(moveProvider(enabled, row.id, 1))}
              >
                <ChevronDownIcon />
              </button>
            </span>
            <span role="cell" className="seg-providers__end">
              <Switch
                checked={row.enabled}
                labelId={`${id}-${row.id}`}
                onChange={(on) => set(setProviderEnabled(enabled, row.id, on))}
              />
            </span>
          </div>
        ))}
      </div>
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

const Fingerprint = ({ form }: { form: Form }) => {
  const { t } = useTranslation()
  const id = useId()
  const enabled = form.draft.fingerprintEnabled
  const submit = (event: FormEvent) => {
    event.preventDefault()
    form.save()
  }
  return (
    <div className="settings-block">
      <SwitchSetting
        label={t('admin.settings.segments.fingerprint')}
        checked={enabled}
        onChange={(on) => form.set('fingerprintEnabled', on)}
      />
      <form className="seg-thresholds" onSubmit={submit} noValidate data-disabled={!enabled}>
        {thresholdFields.map((field) => {
          const invalid = form.invalid.includes(field)
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
                value={form.draft[field]}
                aria-invalid={invalid}
                onChange={(event) => form.set(field, event.target.value)}
              />
            </Field>
          )
        })}
      </form>
    </div>
  )
}

const Contribution = ({ form, keyConfigured }: { form: Form; keyConfigured: boolean }) => {
  const { t } = useTranslation()
  const on = form.draft.contribution
  return (
    <div className="settings-block">
      <SwitchSetting
        label={t('admin.settings.segments.contribution')}
        {...(keyConfigured
          ? {}
          : { description: t('admin.settings.segments.contributionNeedsKey') })}
        checked={on}
        disabled={!keyConfigured && !on}
        onChange={(next) => {
          if (next && !keyConfigured) return
          form.set('contribution', next)
        }}
      />
    </div>
  )
}

/**
 * Settings › Intros and credits (§12, §15): the providers and their order, TheIntroDB's key
 * (replaced at once through its own "Validate"), fingerprinting, contribution; the rest saved by
 * the save bar.
 */
export const SegmentSettings = ({ segments }: { segments: SegmentSettingsDto }) => {
  const { t } = useTranslation()
  const form = useSettingsForm({ saved: segmentsDraftOf(segments), changes: segmentsChanges })
  const key = segments.theintrodbApiKey
  return (
    <>
      <section className="settings-section" aria-label={t('admin.tabs.segments')}>
        <Providers form={form} />
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
        <Fingerprint form={form} />
        <Contribution form={form} keyConfigured={key.configured} />
      </section>
      <SaveBar form={form} />
    </>
  )
}
