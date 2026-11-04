import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { z } from 'zod'

import { appError, err, ok } from '@projo/shared'

import type { ClientMetadataFetcher } from '../../core/auth/oauth.ts'

const maxBytes = 64 * 1024
const timeoutMs = 5_000

const documentSchema = z.object({
  client_id: z.string(),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string()).max(50),
})

export const isPrivateAddress = (address: string): boolean => {
  const version = isIP(address)
  if (version === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }
  if (version === 6) {
    const lower = address.toLowerCase()
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
    if (mapped !== undefined) return isPrivateAddress(mapped)
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') ||
      lower.startsWith('ff')
    )
  }
  return true
}

type Options = {
  allowPrivateAddresses?: boolean
  fetch?: typeof fetch
}

export const createClientMetadataFetcher = ({
  allowPrivateAddresses = false,
  fetch: fetchImpl = fetch,
}: Options = {}): ClientMetadataFetcher => {
  const invalid = (url: string, reason: string) =>
    err(
      appError('oauth/invalid_client', 'client metadata document unavailable', {
        context: { clientId: url, reason },
      }),
    )

  return async (url) => {
    if (!URL.canParse(url)) return invalid(url, 'not a URL')
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && !(allowPrivateAddresses && parsed.protocol === 'http:')) {
      return invalid(url, 'not HTTPS')
    }
    if (!allowPrivateAddresses) {
      const host = parsed.hostname.replace(/^\[|\]$/g, '')
      let addresses: { address: string }[]
      try {
        addresses = isIP(host) === 0 ? await lookup(host, { all: true }) : [{ address: host }]
      } catch {
        return invalid(url, 'host not found')
      }
      if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
        return invalid(url, 'private address')
      }
    }
    let text: string
    try {
      const response = await fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return invalid(url, `status ${response.status}`)
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > maxBytes) return invalid(url, 'too large')
      text = await response.text()
    } catch {
      return invalid(url, 'unreachable')
    }
    if (text.length > maxBytes) return invalid(url, 'too large')
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return invalid(url, 'not JSON')
    }
    const document = documentSchema.safeParse(json)
    if (!document.success) return invalid(url, 'not a client metadata document')
    if (document.data.client_id !== url) return invalid(url, 'client_id does not match its URL')
    return ok({
      clientId: url,
      redirectUris: document.data.redirect_uris,
      ...(document.data.client_name === undefined ? {} : { name: document.data.client_name }),
    })
  }
}
