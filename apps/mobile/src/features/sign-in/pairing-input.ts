import { err, ok, type Result } from '@projo/shared/result'

import { pairingCodeAlphabet, pairingCodeLength, pairingPath } from '@projo/shared/api/auth'

import { type Failure, failure } from '../../shared/api/failure.ts'
import { normalizeServerUrl } from '../server-connection/server-url.ts'

export type PairingInput = { readonly code: string; readonly serverUrl?: string }
export type PairingLink = { readonly code: string; readonly serverUrl: string }

export type PairingInputError = Failure<
  'auth/pairing_invalid' | 'pairing/not_a_code' | 'connection/invalid_url'
>

const codePattern = new RegExp(`^[${pairingCodeAlphabet}]{${pairingCodeLength}}$`)
const linkPattern = new RegExp(`^(.+?)${pairingPath}/?\\?(?:[^#]*&)?code=([^&#]*)`, 'i')

export const normalizePairingCode = (
  input: string,
): Result<string, Failure<'auth/pairing_invalid'>> => {
  const code = input.toUpperCase().replace(/[\s\-‐-―]/g, '')
  return codePattern.test(code)
    ? ok(code)
    : err(failure('auth/pairing_invalid', 'not a pairing code', { context: { input } }))
}

export const parsePairingLink = (text: string): Result<PairingLink, PairingInputError> => {
  const match = linkPattern.exec(text.trim())
  if (!match)
    return err(failure('pairing/not_a_code', 'not a projo pairing link', { context: { text } }))
  const serverUrl = normalizeServerUrl(match[1] ?? '')
  if (!serverUrl.ok) return serverUrl
  const code = normalizePairingCode(match[2] ?? '')
  return code.ok ? ok({ code: code.value, serverUrl: serverUrl.value }) : code
}

export const parseTypedPairing = (text: string): Result<PairingInput, PairingInputError> => {
  if (linkPattern.test(text.trim())) return parsePairingLink(text)
  const code = normalizePairingCode(text)
  return code.ok ? ok({ code: code.value }) : code
}
