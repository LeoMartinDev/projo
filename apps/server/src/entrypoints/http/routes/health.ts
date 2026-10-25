import { Hono } from 'hono'

import type { HealthResponse } from '@projo/shared/api/common'

import type { AppEnv } from '../context.ts'

export type HealthRoutesDeps = {
  version: string
  runtime: string
}

/** `GET /health`, outside `/api/v1`, no auth (§17.2 System). 200 = healthy (supervisor, Docker). */
export const healthRoutes = ({ version, runtime }: HealthRoutesDeps) =>
  new Hono<AppEnv>().get('/health', (c) =>
    c.json({ status: 'ok', version, runtime } satisfies HealthResponse),
  )
