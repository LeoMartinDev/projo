import type { TvErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const tvErrorStatus = {
  'tv/source_not_found': 404,
  'tv/source_unreachable': 502,
  'tv/source_invalid': 422,
  'tv/account_refused': 502,
  'tv/group_not_found': 404,
  'tv/channel_not_found': 404,
  'tv/logo_unavailable': 502,
  'tv/connection_limit_reached': 503,
  'tv/stream_unavailable': 502,
  'tv/session_not_found': 404,
  'tv/segment_not_found': 404,
  'tv/guide_unreachable': 502,
  'tv/guide_invalid': 422,
  'tv/programme_not_found': 404,
} satisfies ErrorStatusMap<TvErrorCode>
