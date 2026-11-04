import type { Context } from 'hono'

export const noContent = (c: Context) => c.newResponse(undefined as never, 204)
