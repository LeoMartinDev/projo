import type { TFunction } from 'i18next'

import { rootErrorReasonSchema } from '@projo/shared/api/libraries'
import type { NotificationDto, NotificationKind } from '@projo/shared/api/notifications'
import { isErrorCode } from '@projo/shared/errors'

import { formatBytes } from '../../../shared/format/format.ts'
import { rootErrorLabel } from '../library-status.tsx'
import { isJobType } from './job-types.ts'

const text = (context: Record<string, unknown>, key: string): string | undefined => {
  const value = context[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

const number = (context: Record<string, unknown>, key: string): number | undefined => {
  const value = context[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * The line under a notification's title (§15 centre): what it is about, from its `context`
 * (paths, versions, the failed job and its error). `undefined` when the title says it all.
 */
export const notificationDetail = (
  notification: Pick<NotificationDto, 'kind' | 'context'>,
  t: TFunction,
  locale: string,
): string | undefined => {
  const { context } = notification
  switch (notification.kind) {
    case 'library/root_unreachable': {
      const reason = rootErrorReasonSchema.safeParse(context.reason).data
      const parts = [
        reason === undefined ? undefined : rootErrorLabel(t, reason),
        text(context, 'path'),
      ].filter((part) => part !== undefined)
      return parts.length === 0 ? undefined : parts.join(' · ')
    }
    case 'scan/source_stuck_pending':
    case 'scan/unsupported_layout':
      return text(context, 'path')
    case 'scan/needs_review_count': {
      const count = number(context, 'count')
      return count === undefined ? undefined : t('admin.review.count', { count })
    }
    case 'job/failed': {
      const type = text(context, 'jobType')
      const code = text(context, 'code')
      const message = text(context, 'message')
      const error =
        code !== undefined && isErrorCode(code) ? t(`errors.${code}`) : (message ?? code)
      return [type !== undefined && isJobType(type) ? t(`admin.jobs.type.${type}`) : type, error]
        .filter((part) => part !== undefined)
        .join(' · ')
    }
    case 'update/available':
      return text(context, 'version')
    case 'update/runtime_too_old': {
      const version = text(context, 'version')
      const runtimeMin = text(context, 'runtimeMin')
      return version === undefined || runtimeMin === undefined
        ? version
        : t('admin.notificationCenter.runtimeNeeded', { version, runtime: runtimeMin })
    }
    case 'update/failed': {
      const code = text(context, 'code')
      const message =
        code !== undefined && isErrorCode(code) ? t(`errors.${code}`) : text(context, 'message')
      return [text(context, 'version'), message].filter((part) => part !== undefined).join(' · ')
    }
    case 'update/rolled_back': {
      const from = text(context, 'from')
      const to = text(context, 'to')
      return from === undefined || to === undefined
        ? undefined
        : t('admin.updates.fromTo', { from, to })
    }
    case 'cache/disk_low': {
      const free = number(context, 'freeBytes')
      return free === undefined
        ? undefined
        : t('admin.notificationCenter.freeSpace', { size: formatBytes(free, locale) })
    }
    case 'metadata/tmdb_key_missing':
    case 'tmdb/unauthorized':
      return undefined
  }
}

/** Where a notification is acted upon: the admin screen of its subject. */
export const notificationTarget = (
  kind: NotificationKind,
):
  | '/admin/libraries'
  | '/admin/pending'
  | '/admin/review'
  | '/admin/jobs'
  | '/admin/updates'
  | '/admin/settings/metadata'
  | '/admin/server' => {
  switch (kind) {
    case 'library/root_unreachable':
    case 'scan/unsupported_layout':
      return '/admin/libraries'
    case 'scan/source_stuck_pending':
      return '/admin/pending'
    case 'scan/needs_review_count':
      return '/admin/review'
    case 'job/failed':
      return '/admin/jobs'
    case 'update/available':
    case 'update/runtime_too_old':
    case 'update/failed':
    case 'update/rolled_back':
      return '/admin/updates'
    case 'metadata/tmdb_key_missing':
    case 'tmdb/unauthorized':
      return '/admin/settings/metadata'
    case 'cache/disk_low':
      return '/admin/server'
  }
}
