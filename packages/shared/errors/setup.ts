export const setupErrorCodes = ['setup/already_completed'] as const

export type SetupErrorCode = (typeof setupErrorCodes)[number]
