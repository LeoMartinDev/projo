import type { Result } from '@projo/shared/result'

import type { ConnectError, ServerState } from './connect-server.ts'

/** The screens before the app (§28.3). */
export type EntryScreen =
  | { readonly kind: 'starting' }
  /** First launch, "Change server", or an address that did not work (`error`: its code). */
  | { readonly kind: 'address'; readonly serverUrl: string; readonly error?: string }
  /** The saved server does not answer: retry, or change it. */
  | { readonly kind: 'unreachable'; readonly serverUrl: string }
  | { readonly kind: 'outdated'; readonly serverUrl: string; readonly version: string }
  /** Setup runs in the browser (§3), never in the app. */
  | { readonly kind: 'not_set_up'; readonly serverUrl: string }

/** A screen, or the app on a server ready for it. */
export type EntryStep = EntryScreen | { readonly kind: 'ready'; readonly serverUrl: string }

/** Where an attempt came from: the address typed, or the saved server (launch, retry). */
export type AttemptSource = 'typed' | 'saved'

/** The screen after the start: the address screen without a saved server or on "Change server". */
export const startingStep = ({
  saved,
  changing,
}: {
  saved: string | undefined
  changing: boolean
}): { connect: string } | EntryScreen =>
  saved === undefined || changing ? { kind: 'address', serverUrl: saved ?? '' } : { connect: saved }

/**
 * The step after a connection attempt. A typed address that fails stays on the address screen
 * with why; the saved server failing shows "unreachable" (retry or change).
 */
export const stepAfter = (
  url: string,
  source: AttemptSource,
  result: Result<ServerState, ConnectError>,
): EntryStep => {
  if (result.ok) return result.value
  const { code } = result.error
  if (source === 'saved' && (code === 'server/unreachable' || code === 'server/not_projo'))
    return { kind: 'unreachable', serverUrl: url }
  return { kind: 'address', serverUrl: url, error: code }
}
