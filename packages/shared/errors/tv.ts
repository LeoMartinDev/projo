export const tvErrorCodes = [
  'tv/source_not_found',
  'tv/source_unreachable',
  'tv/source_invalid',
  'tv/account_refused',
  'tv/group_not_found',
  'tv/channel_not_found',
  'tv/logo_unavailable',
  'tv/connection_limit_reached',
  'tv/stream_unavailable',
  'tv/session_not_found',
  'tv/segment_not_found',
  'tv/guide_unreachable',
  'tv/guide_invalid',
] as const

export type TvErrorCode = (typeof tvErrorCodes)[number]
