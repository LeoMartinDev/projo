import { Hono } from 'hono'

import type { HealthResponse } from '@projo/shared/api/common'

import type { AppEnv } from '../context.ts'

export type HealthRoutesDeps = {
  version: string
  runtime: string
}

export const healthRoutes = ({ version, runtime }: HealthRoutesDeps) =>
  new Hono<AppEnv>().get('/health', (c) =>
    c.json({ status: 'ok', version, runtime } satisfies HealthResponse),
  )
