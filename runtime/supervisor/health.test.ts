import { expect, test } from 'bun:test'
import { supervisorError } from './errors'
import { healthUrl, httpHealthProbeFactory, waitForHealthFactory, type HealthProbe } from './health'
import { err, ok } from './result'
import { manualClock } from './test-support'

test('probes /health over HTTP', async () => {
  let healthy = true
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response('ok', { status: healthy ? 200 : 503 }),
  })
  try {
    const probe = httpHealthProbeFactory({ url: healthUrl(server.port ?? 0), timeoutMs: 1_000 })
    expect(await probe()).toEqual(ok(undefined))
    healthy = false
    const result = await probe()
    expect(result.ok ? undefined : result.error.code).toBe('health/unhealthy')
  } finally {
    await server.stop(true)
  }
  const unreachable = await httpHealthProbeFactory({
    url: healthUrl(server.port ?? 0),
    timeoutMs: 1_000,
  })()
  expect(unreachable.ok ? undefined : unreachable.error.code).toBe('health/unreachable')
})

test('waitForHealth polls until healthy or the deadline', async () => {
  const { clock, advance } = manualClock()
  let calls = 0
  const probe: HealthProbe = async () =>
    ++calls >= 3 ? ok(undefined) : err(supervisorError('health/unreachable', 'down'))
  const waiting = waitForHealthFactory({ probe, clock })({ timeoutMs: 60_000, intervalMs: 1_000 })
  await advance(1_000)
  await advance(1_000)
  expect(await waiting).toEqual(ok(undefined))
  expect(calls).toBe(3)

  const never: HealthProbe = async () => err(supervisorError('health/unreachable', 'down'))
  const timingOut = waitForHealthFactory({ probe: never, clock })({
    timeoutMs: 3_000,
    intervalMs: 1_000,
  })
  for (let i = 0; i < 3; i++) await advance(1_000)
  const result = await timingOut
  expect(result.ok ? undefined : result.error.code).toBe('health/unreachable')
})
