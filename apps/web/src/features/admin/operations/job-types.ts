import type { TFunction } from 'i18next'

import { itemWithSeriesLabel } from '@projo/i18n/item-titles'
import { type JobTargetDto, type JobTypeDto, jobTypes } from '@projo/shared/api/jobs'

export const isJobType = (value: string): value is JobTypeDto =>
  (jobTypes as readonly string[]).includes(value)

export const jobTargetLabel = (t: TFunction, target: JobTargetDto): string => {
  if (target.item !== undefined) return itemWithSeriesLabel(t, target.item)
  return target.label ?? t('admin.jobs.targetGone', { id: target.id })
}
