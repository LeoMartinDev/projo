export const sourceErrorCodes = [
  'source/not_found',
  'source/file_missing',
  /** `DELETE /admin/sources/:id` purges a `missing` source only (§15 "Manquants"). */
  'source/not_missing',
  /** `POST /admin/sources/:id/restore` shows a hidden (`rejected`) source again only (§7.8). */
  'source/not_rejected',
] as const

export type SourceErrorCode = (typeof sourceErrorCodes)[number]
