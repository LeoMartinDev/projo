import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminTvSourceDto } from '@projo/shared/api/tv'

import { Field } from '../../../shared/ui/controls.tsx'
import { CloseIcon } from '../../../shared/ui/icons.tsx'
import type { SourceField, SourceForm } from './source-form.ts'

/**
 * The fields of a TV source. With `stored` (the settings of an existing source), each URL field
 * shows the stored masked URL as its placeholder and the connection limit is offered.
 */
export const SourceFields = ({
  idPrefix,
  form,
  invalid,
  onChange,
  stored,
  kindField,
  autoFocus = false,
}: {
  idPrefix: string
  form: SourceForm
  invalid: ReadonlySet<SourceField>
  onChange: (patch: Partial<SourceForm>) => void
  stored?: AdminTvSourceDto
  kindField?: ReactNode
  autoFocus?: boolean
}) => {
  const { t } = useTranslation()
  const id = (field: SourceField) => `${idPrefix}-${field}`
  const storedGuide = form.removeGuide ? undefined : stored?.settings.guideUrl
  return (
    <>
      <Field id={id('name')} label={t('admin.tv.form.name')} invalid={invalid.has('name')}>
        <input
          id={id('name')}
          className="field__input"
          value={form.name}
          maxLength={100}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={invalid.has('name')}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </Field>
      {kindField}
      <Field
        id={id('playlistUrl')}
        label={t('admin.tv.form.playlistUrl')}
        invalid={invalid.has('playlistUrl')}
      >
        <input
          id={id('playlistUrl')}
          className="field__input mono"
          type="url"
          inputMode="url"
          value={form.playlistUrl}
          maxLength={4096}
          autoComplete="off"
          spellCheck={false}
          {...(stored === undefined ? {} : { placeholder: stored.settings.playlistUrl })}
          aria-invalid={invalid.has('playlistUrl')}
          onChange={(event) => onChange({ playlistUrl: event.target.value })}
        />
      </Field>
      <Field
        id={id('guideUrl')}
        label={t('admin.tv.form.guideUrl')}
        invalid={invalid.has('guideUrl')}
        {...(storedGuide === undefined || form.guideUrl !== ''
          ? {}
          : {
              trail: (
                <span className="field__trail">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('admin.tv.form.removeGuide')}
                    title={t('admin.tv.form.removeGuide')}
                    onClick={() => onChange({ removeGuide: true })}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ),
            })}
      >
        <input
          id={id('guideUrl')}
          className="field__input mono"
          type="url"
          inputMode="url"
          value={form.guideUrl}
          maxLength={4096}
          autoComplete="off"
          spellCheck={false}
          {...(storedGuide === undefined ? {} : { placeholder: storedGuide })}
          aria-invalid={invalid.has('guideUrl')}
          onChange={(event) => onChange({ guideUrl: event.target.value })}
        />
      </Field>
      <Field
        id={id('userAgent')}
        label={t('admin.tv.form.userAgent')}
        invalid={invalid.has('userAgent')}
      >
        <input
          id={id('userAgent')}
          className="field__input mono"
          value={form.userAgent}
          maxLength={512}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid.has('userAgent')}
          onChange={(event) => onChange({ userAgent: event.target.value })}
        />
      </Field>
      {stored === undefined ? undefined : (
        <Field
          id={id('maxConnections')}
          label={t('admin.tv.form.maxConnections')}
          invalid={invalid.has('maxConnections')}
        >
          <input
            id={id('maxConnections')}
            className="field__input"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            step={1}
            value={form.maxConnections}
            placeholder={t('admin.tv.form.noLimit')}
            aria-invalid={invalid.has('maxConnections')}
            onChange={(event) => onChange({ maxConnections: event.target.value })}
          />
        </Field>
      )}
    </>
  )
}
