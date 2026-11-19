import { useState } from 'react'

import type { AdminSettingsDto, UpdateAdminSettingsBody } from '@projo/shared/api/settings'
import type { Result } from '@projo/shared/result'

import { useUpdateSettings } from './queries.ts'
import { changedFields, type Draft, draftOf, editsAfterSave } from './settings-draft.ts'

export type SettingsForm<D extends Draft> = {
  draft: D
  set: <K extends keyof D>(key: K, value: D[K]) => void
  /** The fields whose value cannot be saved as typed. */
  invalid: readonly (keyof D)[]
  dirty: boolean
  pending: boolean
  error: unknown
  save: () => void
  cancel: () => void
}

/**
 * A Settings tab's form (§15): edits stay local until `save`, which sends what changed (`changes`
 * builds the body from the whole draft and the changed fields, or names the invalid ones) and
 * then drops the edits it saved; `cancel` drops them all.
 */
export const useSettingsForm = <D extends Draft, F extends keyof D>({
  saved,
  changes,
  onSaved,
}: {
  saved: D
  changes: (draft: D, changed: Partial<D>) => Result<UpdateAdminSettingsBody, readonly F[]>
  onSaved?: (settings: AdminSettingsDto) => void
}): SettingsForm<D> => {
  const update = useUpdateSettings()
  const [edits, setEdits] = useState<Partial<D>>({})
  const draft = draftOf(saved, edits)
  const changed = changedFields(saved, edits)
  const dirty = Object.keys(changed).length > 0
  const body = changes(draft, changed)
  return {
    draft,
    set: (key, value) => {
      setEdits((current) => ({ ...current, [key]: value }))
      if (update.isError) update.reset()
    },
    invalid: body.ok ? [] : body.error,
    dirty,
    pending: update.isPending,
    error: update.isError ? update.error : undefined,
    save: () => {
      if (!dirty || !body.ok || update.isPending) return
      update.mutate(body.value, {
        onSuccess: (settings) => {
          setEdits((current) => editsAfterSave(current, edits))
          onSaved?.(settings)
        },
      })
    },
    cancel: () => {
      setEdits({})
      update.reset()
    },
  }
}
