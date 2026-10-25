import type { Context } from 'hono'

/** What the server knows about the client, honouring `X-Forwarded-*` only with `TRUST_PROXY` (§20). */
export type ClientInfo = {
  ip: string
  https: boolean
  /** `scheme://host` this request was addressed to: the only accepted `Origin` (§20). */
  origin: string
}

/** Bun's `server.requestIP` (it answers `null` for unix sockets, handled by `?.`). */
type RequestIpServer = { requestIP: (request: Request) => { address: string } | undefined }

const hasRequestIp = (env: unknown): env is RequestIpServer =>
  typeof env === 'object' &&
  Boolean(env) &&
  'requestIP' in (env as object) &&
  typeof (env as { requestIP: unknown }).requestIP === 'function'

const firstValue = (header: string | undefined): string | undefined =>
  header?.split(',')[0]?.trim() || undefined

/** The proxy appends the address it received the request from: the last entry is trustworthy. */
const lastValue = (header: string | undefined): string | undefined =>
  header?.split(',').at(-1)?.trim() || undefined

/** Direct peer address from `Bun.serve` (the server is Hono's `env`); `unknown` in `app.request` tests. */
const directIp = (c: Context): string => {
  const env: unknown = c.env
  return (hasRequestIp(env) && env.requestIP(c.req.raw)?.address) || 'unknown'
}

export const clientInfo = (c: Context, { trustProxy }: { trustProxy: boolean }): ClientInfo => {
  const url = new URL(c.req.url)
  const forwardedProto = trustProxy ? firstValue(c.req.header('x-forwarded-proto')) : undefined
  const forwardedHost = trustProxy ? firstValue(c.req.header('x-forwarded-host')) : undefined
  const https =
    forwardedProto === undefined ? url.protocol === 'https:' : forwardedProto === 'https'
  const host = forwardedHost ?? c.req.header('host') ?? url.host
  const ip = (trustProxy ? lastValue(c.req.header('x-forwarded-for')) : undefined) ?? directIp(c)
  return { ip, https, origin: `${https ? 'https' : 'http'}://${host}` }
}
