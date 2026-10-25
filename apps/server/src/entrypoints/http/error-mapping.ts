import { type ErrorCode, isErrorCode } from '@projo/shared'

import { accountErrorStatus } from './error-mapping/account.ts'
import { authErrorStatus } from './error-mapping/auth.ts'
import { catalogErrorStatus } from './error-mapping/catalog.ts'
import { commonErrorStatus } from './error-mapping/common.ts'
import { configErrorStatus } from './error-mapping/config.ts'
import { dataErrorStatus } from './error-mapping/data.ts'
import { dbErrorStatus } from './error-mapping/db.ts'
import { fsErrorStatus } from './error-mapping/fs.ts'
import { imageErrorStatus } from './error-mapping/image.ts'
import { itemErrorStatus } from './error-mapping/item.ts'
import { jobErrorStatus } from './error-mapping/job.ts'
import { libraryErrorStatus } from './error-mapping/library.ts'
import { mediaErrorStatus } from './error-mapping/media.ts'
import { metadataErrorStatus } from './error-mapping/metadata.ts'
import { notificationErrorStatus } from './error-mapping/notification.ts'
import { playbackErrorStatus } from './error-mapping/playback.ts'
import { profileErrorStatus } from './error-mapping/profile.ts'
import { progressErrorStatus } from './error-mapping/progress.ts'
import { scanErrorStatus } from './error-mapping/scan.ts'
import { segmentErrorStatus } from './error-mapping/segment.ts'
import { setupErrorStatus } from './error-mapping/setup.ts'
import { sourceErrorStatus } from './error-mapping/source.ts'
import type { ErrorStatusCode } from './error-mapping/types.ts'
import { updateErrorStatus } from './error-mapping/update.ts'

/** The single code → status table (§5.3). Typed as total: a missing domain fails typecheck. */
export const errorStatusByCode: Record<ErrorCode, ErrorStatusCode> = {
  ...accountErrorStatus,
  ...authErrorStatus,
  ...catalogErrorStatus,
  ...commonErrorStatus,
  ...configErrorStatus,
  ...dataErrorStatus,
  ...dbErrorStatus,
  ...fsErrorStatus,
  ...imageErrorStatus,
  ...itemErrorStatus,
  ...jobErrorStatus,
  ...libraryErrorStatus,
  ...mediaErrorStatus,
  ...metadataErrorStatus,
  ...notificationErrorStatus,
  ...playbackErrorStatus,
  ...profileErrorStatus,
  ...progressErrorStatus,
  ...scanErrorStatus,
  ...segmentErrorStatus,
  ...setupErrorStatus,
  ...sourceErrorStatus,
  ...updateErrorStatus,
}

/** An unknown code is a bug: 500. */
export const statusForError = (code: string): ErrorStatusCode =>
  isErrorCode(code) ? errorStatusByCode[code] : 500
