export const setupErrorCodes = ['setup/already_completed', 'setup/not_completed'] as const

export type SetupErrorCode = (typeof setupErrorCodes)[number]
