/** HTTP helpers of the updater: every network failure becomes a value, never a throw. */

export type HttpOutcome =
  { kind: 'response'; response: Response } | { kind: 'network_error'; message: string }

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export const USER_AGENT = 'projo-updater'

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/** `fetch` with a timeout, combined with the caller's signal. */
export const httpGet = async ({
  fetch,
  url,
  timeoutMs,
  signal,
  accept,
}: {
  fetch: FetchLike
  url: string
  timeoutMs: number
  signal?: AbortSignal
  accept?: string
}): Promise<HttpOutcome> => {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, ...(accept === undefined ? {} : { accept }) },
      redirect: 'follow',
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    })
    return { kind: 'response', response }
  } catch (cause) {
    return { kind: 'network_error', message: describe(cause) }
  }
}

/** Reads a small body (JSON, `SHA256SUMS`, `manifest.json`); `undefined` when it breaks. */
export const readBytes = async (response: Response): Promise<Uint8Array | undefined> => {
  try {
    return new Uint8Array(await response.arrayBuffer())
  } catch {
    return undefined
  }
}

export const parseJsonBytes = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return undefined
  }
}
