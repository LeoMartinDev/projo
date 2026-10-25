export const configErrorCodes = ['config/invalid'] as const

export type ConfigErrorCode = (typeof configErrorCodes)[number]
