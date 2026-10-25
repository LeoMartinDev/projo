import { accountErrorCodes } from './account.ts'
import { authErrorCodes } from './auth.ts'
import { catalogErrorCodes } from './catalog.ts'
import { commonErrorCodes } from './common.ts'
import { configErrorCodes } from './config.ts'
import { dataErrorCodes } from './data.ts'
import { dbErrorCodes } from './db.ts'
import { fsErrorCodes } from './fs.ts'
import { imageErrorCodes } from './image.ts'
import { itemErrorCodes } from './item.ts'
import { jobErrorCodes } from './job.ts'
import { libraryErrorCodes } from './library.ts'
import { mediaErrorCodes } from './media.ts'
import { metadataErrorCodes } from './metadata.ts'
import { notificationErrorCodes } from './notification.ts'
import { playbackErrorCodes } from './playback.ts'
import { profileErrorCodes } from './profile.ts'
import { progressErrorCodes } from './progress.ts'
import { scanErrorCodes } from './scan.ts'
import { segmentErrorCodes } from './segment.ts'
import { setupErrorCodes } from './setup.ts'
import { sourceErrorCodes } from './source.ts'
import { updateErrorCodes } from './update.ts'

export * from './account.ts'
export * from './app-error.ts'
export * from './auth.ts'
export * from './catalog.ts'
export * from './common.ts'
export * from './config.ts'
export * from './data.ts'
export * from './db.ts'
export * from './fs.ts'
export * from './image.ts'
export * from './item.ts'
export * from './job.ts'
export * from './library.ts'
export * from './media.ts'
export * from './metadata.ts'
export * from './notification.ts'
export * from './playback.ts'
export * from './profile.ts'
export * from './progress.ts'
export * from './scan.ts'
export * from './segment.ts'
export * from './setup.ts'
export * from './source.ts'
export * from './update.ts'

/** Every stable error code. New domain = one file in this folder + one import and one spread here. */
export const errorCodes = [
  ...accountErrorCodes,
  ...authErrorCodes,
  ...catalogErrorCodes,
  ...commonErrorCodes,
  ...configErrorCodes,
  ...dataErrorCodes,
  ...dbErrorCodes,
  ...fsErrorCodes,
  ...imageErrorCodes,
  ...itemErrorCodes,
  ...jobErrorCodes,
  ...libraryErrorCodes,
  ...mediaErrorCodes,
  ...metadataErrorCodes,
  ...notificationErrorCodes,
  ...playbackErrorCodes,
  ...profileErrorCodes,
  ...progressErrorCodes,
  ...scanErrorCodes,
  ...segmentErrorCodes,
  ...setupErrorCodes,
  ...sourceErrorCodes,
  ...updateErrorCodes,
] as const

export type ErrorCode = (typeof errorCodes)[number]

const knownCodes: ReadonlySet<string> = new Set(errorCodes)

export const isErrorCode = (value: string): value is ErrorCode => knownCodes.has(value)
