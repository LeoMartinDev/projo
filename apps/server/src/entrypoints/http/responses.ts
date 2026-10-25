import type { Context } from 'hono'

/**
 * 204 No Content. `as never`: Hono types an empty body as `null`, which §5.3 bans. Headers
 * already set on `c` (cookies) are kept.
 */
export const noContent = (c: Context) => c.newResponse(undefined as never, 204)
