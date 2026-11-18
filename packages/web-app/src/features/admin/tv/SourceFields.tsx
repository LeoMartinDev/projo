import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AdminTvSourceDto,
  limitFromAccount,
  type TvSourceKind,
  tvSourceKinds,
} from '@projo/shared/api/tv'

import { Field } from '../../../shared/ui/controls.tsx'
import { CloseIcon } from '../../../shared/ui/icons.tsx'
import type { SourceField, SourceForm } from './source-form.ts'

type FieldsProps = {
  idPrefix: string
  form: SourceForm
  invalid: ReadonlySet<SourceField>
  onChange: (patch: Partial<SourceForm>) => void
  stored?: AdminTvSourceDto
}

const fieldId = (idPrefix: string, field: SourceField) => `${idPrefix}-${field}`

/** An `m3u` source's playlist URL, XMLTV URL and `User-Agent` (§29.6). */
const M3uFields = ({ idPrefix, form, invalid, onChange, stored }: FieldsProps) => {
  const { t } = useTranslation()
  const id = (field: SourceField) => fieldId(idPrefix, field)
  const settings = stored?.settings.kind === 'm3u' ? stored.settings : undefined
  const storedGuide = form.removeGuide ? undefined : settings?.guideUrl
  return (
    <>
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
          {...(settings === undefined ? {} : { placeholder: settings.playlistUrl })}
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
    </>
  )
}

/** What a stored credential shows: never returned, only kept (§29.7). */
const storedSecret = '••••••••'

/** An Xtream Codes panel's server URL, username and password (§29.6). */
const XtreamFields = ({ idPrefix, form, invalid, onChange, stored }: FieldsProps) => {
  const { t } = useTranslation()
  const id = (field: SourceField) => fieldId(idPrefix, field)
  const secretPlaceholder = stored === undefined ? {} : { placeholder: storedSecret }
  return (
    <>
      <Field
        id={id('serverUrl')}
        label={t('admin.tv.form.serverUrl')}
        invalid={invalid.has('serverUrl')}
      >
        <input
          id={id('serverUrl')}
          className="field__input mono"
          type="url"
          inputMode="url"
          value={form.serverUrl}
          maxLength={512}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid.has('serverUrl')}
          onChange={(event) => onChange({ serverUrl: event.target.value })}
        />
      </Field>
      <Field
        id={id('username')}
        label={t('admin.tv.form.username')}
        invalid={invalid.has('username')}
      >
        <input
          id={id('username')}
          className="field__input mono"
          value={form.username}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          {...secretPlaceholder}
          aria-invalid={invalid.has('username')}
          onChange={(event) => onChange({ username: event.target.value })}
        />
      </Field>
      <Field
        id={id('password')}
        label={t('admin.tv.form.password')}
        invalid={invalid.has('password')}
      >
        <input
          id={id('password')}
          className="field__input mono"
          type="password"
          value={form.password}
          maxLength={200}
          autoComplete="new-password"
          spellCheck={false}
          {...secretPlaceholder}
          aria-invalid={invalid.has('password')}
          onChange={(event) => onChange({ password: event.target.value })}
        />
      </Field>
    </>
  )
}

/** A Freebox's address on its network (§29.6). */
const FreeboxFields = ({ idPrefix, form, invalid, onChange }: FieldsProps) => {
  const { t } = useTranslation()
  const id = fieldId(idPrefix, 'address')
  return (
    <Field id={id} label={t('admin.tv.form.address')} invalid={invalid.has('address')}>
      <input
        id={id}
        className="field__input mono"
        type="url"
        inputMode="url"
        value={form.address}
        maxLength={512}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid.has('address')}
        onChange={(event) => onChange({ address: event.target.value })}
      />
    </Field>
  )
}

const KindFields = ({ kind, ...props }: FieldsProps & { kind: TvSourceKind }) => {
  switch (kind) {
    case 'm3u':
      return <M3uFields {...props} />
    case 'xtream':
      return <XtreamFields {...props} />
    case 'freebox':
      return <FreeboxFields {...props} />
  }
}

/**
 * The fields of a TV source: its name, `kindField`, then its kind's settings. With `stored` (an
 * existing source), each masked field shows the stored value as its placeholder and the
 * connection limit is offered (read-only when it is the provider account's). `reserveKinds` (the kind can change) lays every kind's fields
 * over one another, the others hidden, so the form keeps its size when the kind changes.
 */
export const SourceFields = ({
  idPrefix,
  form,
  invalid,
  onChange,
  stored,
  kindField,
  reserveKinds = false,
  autoFocus = false,
}: FieldsProps & { kindField?: ReactNode; reserveKinds?: boolean; autoFocus?: boolean }) => {
  const { t } = useTranslation()
  const id = (field: SourceField) => fieldId(idPrefix, field)
  const props = { idPrefix, form, invalid, onChange, ...(stored === undefined ? {} : { stored }) }
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
      {reserveKinds ? (
        <div className="tv-form__kinds">
          {tvSourceKinds.map((kind) => (
            <div
              key={kind}
              className="tv-form__kind"
              inert={kind !== form.kind}
              aria-hidden={kind !== form.kind}
            >
              <KindFields kind={kind} {...props} />
            </div>
          ))}
        </div>
      ) : (
        <KindFields kind={form.kind} {...props} />
      )}
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
            readOnly={limitFromAccount(form.kind)}
            placeholder={t('admin.tv.form.noLimit')}
            aria-invalid={invalid.has('maxConnections')}
            onChange={(event) => onChange({ maxConnections: event.target.value })}
          />
        </Field>
      )}
    </>
  )
}
