import { appError, type AppError, err } from '@projo/shared'

import type { PlaybackSession } from '../../../core/playback/session.ts'

export type SessionAccessError = AppError<'playback/session_not_found' | 'playback/session_expired'>

export const sessionNotFound = (sessionId: string) =>
  err(
    appError('playback/session_not_found', 'playback session not found', {
      context: { sessionId },
    }),
  )

export const sessionExpired = (sessionId: string) =>
  err(appError('playback/session_expired', 'playback session ended', { context: { sessionId } }))

export type PlaybackAccess = {
  sessionId: string
  accountId: string
  profileId: string | undefined
}

export type ItemVisibility = (input: { itemId: string; profileId: string }) => boolean

export const usableBy = (
  session: PlaybackSession,
  { accountId, profileId }: Omit<PlaybackAccess, 'sessionId'>,
  isItemVisible: ItemVisibility,
): boolean =>
  session.accountId === accountId &&
  profileId !== undefined &&
  (session.profileId === profileId || isItemVisible({ itemId: session.itemId, profileId }))
