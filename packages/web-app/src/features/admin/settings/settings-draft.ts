/**
 * The one save model of the Settings tabs (§15): a tab's edits stay local, over the saved values,
 * until "Save"; the save bar shows while any of them differs from what is saved.
 */
export type DraftValue = string | number | boolean | readonly (string | number | boolean)[]

export type Draft = Record<string, DraftValue>

export const sameValue = (left: DraftValue, right: DraftValue): boolean => {
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => value === right[index])
  return left === right
}

/** What the form shows: the saved values, each replaced by its edit. */
export const draftOf = <D extends Draft>(saved: D, edits: Partial<D>): D => ({ ...saved, ...edits })

/** The edits that differ from the saved values: what "Save" sends. */
export const changedFields = <D extends Draft>(saved: D, edits: Partial<D>): Partial<D> =>
  Object.fromEntries(
    Object.entries(edits).filter(([key, value]) => {
      const before = saved[key]
      return value !== undefined && (before === undefined || !sameValue(value, before))
    }),
  ) as Partial<D>

export const isDirty = <D extends Draft>(saved: D, edits: Partial<D>): boolean =>
  Object.keys(changedFields(saved, edits)).length > 0

/** The edits left once `sent` is saved: those made meanwhile stay, unsaved. */
export const editsAfterSave = <D extends Draft>(
  current: Partial<D>,
  sent: Partial<D>,
): Partial<D> =>
  Object.fromEntries(
    Object.entries(current).filter(([key, value]) => {
      const saved = sent[key]
      return value !== undefined && (saved === undefined || !sameValue(value, saved))
    }),
  ) as Partial<D>
