import { fetchFailureReason } from './fetch-failure.ts'

type Fetch = (input: string, init: BunFetchRequestInit) => Promise<Response>

/** Redirects a request follows at most (§29.2, §29.3). */
export const TV_MAX_REDIRECTS = 5

const redirectStatuses = new Set([301, 302, 303, 307, 308])

export type Followed = { ok: true; response: Response } | { ok: false; reason: string }

/**
 * `GET url`, redirects followed one by one (at most `TV_MAX_REDIRECTS`): only to `http` or
 * `https`, and never from `https` down to `http`, which would send the URL's credentials in clear
 * (§29.2, §29.3). A refusal is a fixed reason (`insecure_redirect`, `unsupported_redirect`,
 * `too_many_redirects`), a failed request its `fetchFailureReason`; never the URL. A redirect
 * without a usable `Location` is answered as it is (its 3xx status).
 */
export const fetchFollowingRedirects = async (
  url: string,
  init: Omit<BunFetchRequestInit, 'redirect'>,
  doFetch: Fetch,
): Promise<Followed> => {
  let current = url
  for (let redirects = 0; ; redirects += 1) {
    const fetched = await doFetch(current, { ...init, redirect: 'manual' }).then(
      (response) => ({ ok: true as const, response }),
      (cause: unknown) => ({ ok: false as const, reason: fetchFailureReason(cause) }),
    )
    if (!fetched.ok) return fetched
    const { response } = fetched
    const location = response.headers.get('location') ?? undefined
    if (
      !redirectStatuses.has(response.status) ||
      location === undefined ||
      !URL.canParse(location, current)
    )
      return fetched
    await response.body?.cancel().catch(() => {})
    const next = new URL(location, current)
    if (next.protocol !== 'http:' && next.protocol !== 'https:')
      return { ok: false, reason: 'unsupported_redirect' }
    if (new URL(current).protocol === 'https:' && next.protocol === 'http:')
      return { ok: false, reason: 'insecure_redirect' }
    if (redirects >= TV_MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' }
    current = next.href
  }
}
