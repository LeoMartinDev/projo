import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AvatarColor,
  pinSchema,
  type ProfileDto,
  profileNameSchema,
  type UpdateProfileBody,
} from '@projo/shared/api/profiles'

import { Field } from '../../shared/ui/controls.tsx'
import { Dialog } from '../../shared/ui/Dialog.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { Avatar } from '../shell/Avatar.tsx'
import { ColorSwatches, PinFields } from './IdentityFields.tsx'
import { useCreateProfile, useDeleteProfile, useUpdateProfile } from './queries.ts'

export type EditorTarget =
  { mode: 'create' } | { mode: 'edit'; profile: ProfileDto; currentPin?: string }

/**
 * Create or change a profile (§13.6): name, colour among six, optional 4-digit PIN; delete with
 * confirmation (its progress is lost). Built with the kit v2 fields, in a dialog.
 */
export const ProfileEditor = ({
  target,
  canDelete,
  onClose,
}: {
  target: EditorTarget | undefined
  canDelete: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  return (
    <Dialog
      open={target !== undefined}
      title={
        target?.mode === 'edit' ? t('profiles.editor.editTitle') : t('profiles.editor.createTitle')
      }
      onClose={onClose}
    >
      {target === undefined ? undefined : (
        <EditorForm
          key={target.mode === 'edit' ? target.profile.id : 'create'}
          target={target}
          canDelete={canDelete}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

const EditorForm = ({
  target,
  canDelete,
  onClose,
}: {
  target: EditorTarget
  canDelete: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const editing = target.mode === 'edit' ? target.profile : undefined
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState<AvatarColor | undefined>(editing?.avatarColor)
  const [pinOn, setPinOn] = useState(editing?.hasPin ?? false)
  const [changingPin, setChangingPin] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const create = useCreateProfile()
  const update = useUpdateProfile()
  const remove = useDeleteProfile()
  const currentPin = target.mode === 'edit' ? target.currentPin : undefined

  const nameValid = profileNameSchema.safeParse(name).success
  const needsNewPin = pinOn && (!editing?.hasPin || changingPin)
  const pinValid = !needsNewPin || pinSchema.safeParse(pin).success
  const ready = nameValid && pinValid
  const pending = create.isPending || update.isPending || remove.isPending
  const error = create.error || update.error || remove.error

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!ready || pending) return
    if (editing === undefined) {
      create.mutate(
        {
          name: name.trim(),
          ...(color === undefined ? {} : { avatarColor: color }),
          ...(pinOn ? { pin } : {}),
        },
        { onSuccess: onClose },
      )
      return
    }
    const body: UpdateProfileBody = {
      ...(name.trim() === editing.name ? {} : { name: name.trim() }),
      ...(color === undefined || color === editing.avatarColor ? {} : { avatarColor: color }),
      ...(needsNewPin ? { pin } : editing.hasPin && !pinOn ? { pin: '' } : {}),
      ...(currentPin === undefined ? {} : { currentPin }),
    }
    update.mutate({ id: editing.id, body }, { onSuccess: onClose })
  }

  if (confirmDelete && editing !== undefined)
    return (
      <div className="profile-editor">
        <p className="dialog__text">{t('profiles.editor.deleteText', { name: editing.name })}</p>
        {remove.isError ? <ErrorAlert error={remove.error} /> : undefined}
        <div className="profile-editor__actions">
          <button type="button" className="button" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(
                { id: editing.id, ...(currentPin === undefined ? {} : { currentPin }) },
                { onSuccess: onClose },
              )
            }
          >
            {remove.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('profiles.editor.deleteConfirm')}
          </button>
        </div>
      </div>
    )

  return (
    <form className="profile-editor" onSubmit={submit} noValidate>
      <div className="profile-editor__preview" aria-hidden="true">
        <Avatar
          name={name.trim() === '' ? '?' : name}
          color={color ?? editing?.avatarColor ?? 'blue'}
          size="xlarge"
        />
      </div>
      {error ? <ErrorAlert error={error} /> : undefined}
      <Field
        id={`${ids}-name`}
        label={t('profiles.editor.name')}
        invalid={name.length > 0 && !nameValid}
      >
        <input
          id={`${ids}-name`}
          className="field__input"
          maxLength={32}
          autoComplete="off"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <ColorSwatches value={color ?? editing?.avatarColor} onChange={setColor} />

      <PinFields
        hasPin={editing?.hasPin ?? false}
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

      <div className="profile-editor__actions">
        {editing !== undefined && canDelete ? (
          <button
            type="button"
            className="button button--danger profile-editor__delete"
            onClick={() => setConfirmDelete(true)}
          >
            {t('profiles.editor.delete')}
          </button>
        ) : undefined}
        <button type="button" className="button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="button button--primary" disabled={!ready || pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : undefined}
          {editing === undefined ? t('profiles.editor.create') : t('common.save')}
        </button>
      </div>
    </form>
  )
}
