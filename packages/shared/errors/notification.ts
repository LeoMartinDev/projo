export const notificationErrorCodes = ['notification/not_found'] as const

export type NotificationErrorCode = (typeof notificationErrorCodes)[number]
