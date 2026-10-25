import type { TFunction } from 'i18next'

import { type JobTargetDto, type JobTypeDto, jobTypes } from '@projo/shared/api/jobs'

import { itemWithSeriesLabel } from '../../../shared/i18n/item-titles.ts'

/** A job type this version knows (a notification may name one from another version). */
export const isJobType = (value: string): value is JobTypeDto =>
  (jobTypes as readonly string[]).includes(value)

/**
 * The "cible" line of a job (§15): an item or a season composed in the interface language
 * ("Severance · S2 · E4"), a library, file or version by its name, "Deleted (id)" once gone.
 */
export const jobTargetLabel = (t: TFunction, target: JobTargetDto): string => {
  if (target.item !== undefined) return itemWithSeriesLabel(t, target.item)
  return target.label ?? t('admin.jobs.targetGone', { id: target.id })
}
