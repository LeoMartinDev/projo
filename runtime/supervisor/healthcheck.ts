// Docker HEALTHCHECK: exit 0 when the app answers /health, 1 otherwise.
import { healthUrl, httpHealthProbeFactory } from './health'

const port = Number(process.env.PORT ?? '8080')
const result = await httpHealthProbeFactory({ url: healthUrl(port), timeoutMs: 4_000 })()
if (!result.ok) console.error(`${result.error.code}: ${result.error.message}`)
process.exit(result.ok ? 0 : 1)
