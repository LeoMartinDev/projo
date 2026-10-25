export const progressErrorCodes = [
  'progress/invalid_position',
  'progress/item_not_playable',
] as const

export type ProgressErrorCode = (typeof progressErrorCodes)[number]
