export const itemErrorCodes = [
  'item/not_found',
  'item/no_playable_source',
  'item/invalid_kind',
] as const

export type ItemErrorCode = (typeof itemErrorCodes)[number]
