import { type OAuthAuthorizeQuery, oauthAuthorizeQuerySchema } from '@projo/shared/api/oauth'

const queryKeys = Object.keys(oauthAuthorizeQuerySchema.shape)

/**
 * The client's authorization request, read from the address bar as it came (§27.3). A missing or
 * repeated parameter, or one out of bounds, makes the request invalid: the page shows the error
 * and never redirects.
 */
export const readAuthorizeQuery = (search: string): OAuthAuthorizeQuery | undefined => {
  const params = new URLSearchParams(search)
  const entries: [string, string][] = []
  for (const key of queryKeys) {
    const values = params.getAll(key)
    if (values.length > 1) return undefined
    const [value] = values
    if (value !== undefined) entries.push([key, value])
  }
  const parsed = oauthAuthorizeQuerySchema.safeParse(Object.fromEntries(entries))
  return parsed.success ? parsed.data : undefined
}
