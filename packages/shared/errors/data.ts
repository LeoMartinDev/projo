export const dataErrorCodes = ['data/layout_failed'] as const

export type DataErrorCode = (typeof dataErrorCodes)[number]
