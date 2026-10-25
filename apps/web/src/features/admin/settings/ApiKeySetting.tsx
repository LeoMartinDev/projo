import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { UpdateAdminSettingsBody } from '@projo/shared/api/settings'

import { Field, RevealButton } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { KeyIcon } from '../admin-icons.tsx'
import { useUpdateSettings } from './queries.ts'

type KeyStatus = { configured: boolean; last4?: string; rejected?: boolean }

/**
 * An API key (TMDB §9.1, TheIntroDB §12.2): never shown back, only "configured · ••••1234";
 * validated by the server before it is stored, `""` removes it.
 */
export const ApiKeySetting = ({
  label,
  status,
  minLength,
  toBody,
  removeTitle,
  removeText,
  link,
}: {
  label: string
  status: KeyStatus
  minLength: number
  toBody: (key: string) => UpdateAdminSettingsBody
  removeTitle: string
  removeText: string
  link?: { href: string; label: string }
}) => {
  const { t } = useTranslation()
  const id = useId()
  const update = useUpdateSettings()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [shown, setShown] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const remove = useUpdateSettings()

  const showForm = editing || !status.configured
  const trimmed = value.trim()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (trimmed.length < minLength || update.isPending) return
    update.mutate(toBody(trimmed), {
      onSuccess: () => {
        setEditing(false)
        setValue('')
        setShown(false)
      },
    })
  }

  return (
    <div className="settings-block">
      {showForm ? (
        <form className="settings-key" onSubmit={submit} noValidate>
          <Field
            id={`${id}-key`}
            label={label}
            icon={<KeyIcon />}
            invalid={update.isError}
            trail={<RevealButton shown={shown} onToggle={() => setShown(!shown)} />}
          >
            <input
              id={`${id}-key`}
              className="field__input mono"
              type={shown ? 'text' : 'password'}
              value={value}
              autoComplete="off"
              spellCheck={false}
              maxLength={1024}
              aria-invalid={update.isError}
              onChange={(event) => {
                setValue(event.target.value)
                if (update.isError) update.reset()
              }}
            />
          </Field>
          <div className="settings-key__actions">
            {editing ? (
              <button
                type="button"
                className="button"
                onClick={() => {
                  setEditing(false)
                  setValue('')
                  update.reset()
                }}
              >
                {t('common.cancel')}
              </button>
            ) : undefined}
            <button
              type="submit"
              className="button button--primary"
              disabled={trimmed.length < minLength || update.isPending}
            >
              {update.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
              {t('admin.settings.validateKey')}
            </button>
          </div>
        </form>
      ) : (
        <div className="settings-key settings-key--set well">
          <span className="settings-key__icon" aria-hidden="true">
            <KeyIcon />
          </span>
          <div className="settings-key__text">
            <span className="settings-key__label">{label}</span>
            <span className="settings-key__value">
              <span
                className={`dot ${status.rejected === true ? 'dot--error' : 'dot--ok'}`}
                aria-hidden="true"
              />
              {status.rejected === true
                ? t('admin.settings.rejectedWith', { last4: status.last4 ?? '' })
                : status.last4 === undefined
                  ? t('admin.settings.configured')
                  : t('admin.settings.configuredWith', { last4: status.last4 })}
            </span>
          </div>
          <div className="settings-key__actions">
            <button
              type="button"
              className="button button--glass button--small"
              onClick={() => setEditing(true)}
            >
              {t('admin.settings.replaceKey')}
            </button>
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => setConfirmRemove(true)}
            >
              {t('admin.settings.removeKey')}
            </button>
          </div>
        </div>
      )}
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
      {link === undefined ? undefined : (
        <a className="settings-link" href={link.href} target="_blank" rel="noreferrer">
          {link.label}
        </a>
      )}

      <Dialog
        open={confirmRemove}
        title={removeTitle}
        onClose={() => {
          setConfirmRemove(false)
          remove.reset()
        }}
        footer={
          <>
            <button type="button" className="button" onClick={() => setConfirmRemove(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(toBody(''), { onSuccess: () => setConfirmRemove(false) })
              }
            >
              {remove.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
              {t('admin.settings.removeKey')}
            </button>
          </>
        }
      >
        <p className="dialog__text">{removeText}</p>
        {remove.isError ? <ErrorAlert error={remove.error} /> : undefined}
      </Dialog>
    </div>
  )
}
