import { err, ok, type Result } from '@projo/shared/result'

import { pairingCodeAlphabet, pairingCodeLength, pairingPath } from '@projo/shared/api/auth'

import { type Failure, failure } from '../../shared/api/failure.ts'
import { normalizeServerUrl } from '../server-connection/server-url.ts'

/** A pairing code to claim (§14), and the server it belongs to when the input named one. */
export type PairingInput = { readonly code: string; readonly serverUrl?: string }
/** What the QR code of "Connect a device" holds: always both. */
export type PairingLink = { readonly code: string; readonly serverUrl: string }

export type PairingInputError = Failure<
  'auth/pairing_invalid' | 'pairing/not_a_code' | 'connection/invalid_url'
>

const codePattern = new RegExp(`^[${pairingCodeAlphabet}]{${pairingCodeLength}}$`)
/** `<origin>/pair?…code=<code>…`: the origin is everything before `/pair`. */
const linkPattern = new RegExp(`^(.+?)${pairingPath}/?\\?(?:[^#]*&)?code=([^&#]*)`, 'i')

/**
 * A code as typed or shown (`abc 234`, `ABC-234`) → its canonical form (`ABC234`): the server reads
 * codes without case, spaces or dashes; checked locally so a typo costs no claim attempt (10 per
 * 15 minutes, §14).
 */
export const normalizePairingCode = (
  input: string,
): Result<string, Failure<'auth/pairing_invalid'>> => {
  const code = input.toUpperCase().replace(/[\s\-‐-―]/g, '')
  return codePattern.test(code)
    ? ok(code)
    : err(failure('auth/pairing_invalid', 'not a pairing code', { context: { input } }))
}

/**
 * What the QR code of "Connect a device" holds (`<origin>/pair?code=<code>`, §14) → its server URL
 * and code. Anything else is `pairing/not_a_code`: a QR code that is not projo's.
 */
export const parsePairingLink = (text: string): Result<PairingLink, PairingInputError> => {
  const match = linkPattern.exec(text.trim())
  if (!match)
    return err(failure('pairing/not_a_code', 'not a projo pairing link', { context: { text } }))
  const serverUrl = normalizeServerUrl(match[1] ?? '')
  if (!serverUrl.ok) return serverUrl
  // The web encodes the code with `encodeURIComponent`: a no-op on its alphabet, so no decoding.
  const code = normalizePairingCode(match[2] ?? '')
  return code.ok ? ok({ code: code.value, serverUrl: serverUrl.value }) : code
}

/** A typed code, or a pasted pairing link (which then also names the server). */
export const parseTypedPairing = (text: string): Result<PairingInput, PairingInputError> => {
  if (linkPattern.test(text.trim())) return parsePairingLink(text)
  const code = normalizePairingCode(text)
  return code.ok ? ok({ code: code.value }) : code
}
