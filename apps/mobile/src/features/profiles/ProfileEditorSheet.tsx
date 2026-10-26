import { useTranslation } from 'react-i18next'
import { Alert, StyleSheet, View } from 'react-native'

import type { ProfileDto } from '@projo/shared/api/profiles'

import { toFailure } from '../../shared/api/failure.ts'
import { Button } from '../../shared/ui/Button.tsx'
import { ErrorLine } from '../../shared/ui/ErrorLine.tsx'
import { Sheet } from '../../shared/ui/Sheet.tsx'
import { Avatar } from './Avatar.tsx'
import { IdentityFields, useIdentityDraft } from './IdentityFields.tsx'
import { useCreateProfile, useDeleteProfile, useUpdateProfile } from './queries.ts'

export type EditorTarget =
  { mode: 'create' } | { mode: 'edit'; profile: ProfileDto; currentPin?: string }

/**
 * Create or change a profile (§13.6), as the web's editor: name, colour, optional PIN; delete
 * with confirmation (its progress is lost).
 */
export const ProfileEditorSheet = ({
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
    <Sheet
      onClose={onClose}
      open={target !== undefined}
      title={
        target?.mode === 'edit' ? t('profiles.editor.editTitle') : t('profiles.editor.createTitle')
      }
    >
      {target === undefined ? undefined : (
        <EditorForm
          key={target.mode === 'edit' ? target.profile.id : 'create'}
          canDelete={canDelete}
          onClose={onClose}
          target={target}
        />
      )}
    </Sheet>
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
  const editing = target.mode === 'edit' ? target.profile : undefined
  const currentPin = target.mode === 'edit' ? target.currentPin : undefined
  const draft = useIdentityDraft(editing)
  const create = useCreateProfile()
  const update = useUpdateProfile()
  const remove = useDeleteProfile()
  const pending = create.isPending || update.isPending || remove.isPending
  const error = create.error ?? update.error ?? remove.error ?? undefined

  const submit = () => {
    if (!draft.valid || pending) return
    if (editing === undefined) {
      create.mutate(
        {
          name: draft.name.trim(),
          ...(draft.color === undefined ? {} : { avatarColor: draft.color }),
          ...(draft.pinOn ? { pin: draft.pin } : {}),
        },
        { onSuccess: onClose },
      )
      return
    }
    update.mutate(
      {
        id: editing.id,
        body: { ...draft.changes(editing), ...(currentPin === undefined ? {} : { currentPin }) },
      },
      { onSuccess: onClose },
    )
  }

  const confirmDelete = (profile: ProfileDto) =>
    Alert.alert(
      t('profiles.editor.deleteConfirm'),
      t('profiles.editor.deleteText', { name: profile.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profiles.editor.delete'),
          style: 'destructive',
          onPress: () =>
            remove.mutate(
              { id: profile.id, ...(currentPin === undefined ? {} : { currentPin }) },
              { onSuccess: onClose },
            ),
        },
      ],
    )

  return (
    <>
      <View style={styles.preview}>
        <Avatar
          color={draft.color ?? editing?.avatarColor ?? 'blue'}
          name={draft.name.trim() === '' ? '?' : draft.name}
          size={96}
        />
      </View>
      <IdentityFields canEditPin draft={draft} hasPin={editing?.hasPin ?? false} />
      <ErrorLine error={error === undefined ? undefined : toFailure(error)} />
      <Button
        busy={create.isPending || update.isPending}
        disabled={!draft.valid}
        label={editing === undefined ? t('profiles.editor.create') : t('common.save')}
        onPress={submit}
        size="large"
      />
      {editing !== undefined && canDelete ? (
        <Button
          busy={remove.isPending}
          label={t('profiles.editor.delete')}
          onPress={() => confirmDelete(editing)}
          variant="danger"
        />
      ) : undefined}
    </>
  )
}

const styles = StyleSheet.create({ preview: { alignItems: 'center', paddingVertical: 8 } })
