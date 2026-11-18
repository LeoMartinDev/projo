import { Hono } from 'hono'

import type { JobRef } from '@projo/shared/api/jobs'
import {
  type AdminTvChannelsPage,
  type AdminTvSessionsResponse,
  type AdminTvSourcesResponse,
  adminTvChannelsQuerySchema,
  createTvSourceBodySchema,
  setTvEnabledBodySchema,
  updateTvSourceBodySchema,
} from '@projo/shared/api/tv'

import type { CreateTvSource } from '../../../application/tv/create-tv-source.ts'
import type { DeleteTvSource } from '../../../application/tv/delete-tv-source.ts'
import type { GetTvSource } from '../../../application/tv/get-tv-source.ts'
import type { ListTvSourceChannels } from '../../../application/tv/list-tv-source-channels.ts'
import type { ListLiveSessions } from '../../../application/tv/list-live-sessions.ts'
import type { ListTvSources } from '../../../application/tv/list-tv-sources.ts'
import type { RequestTvSourceRefresh } from '../../../application/tv/request-tv-source-refresh.ts'
import type { SetTvChannelEnabled } from '../../../application/tv/set-tv-channel-enabled.ts'
import type { SetTvGroupEnabled } from '../../../application/tv/set-tv-group-enabled.ts'
import type { StopLiveSessionAsAdmin } from '../../../application/tv/stop-live-session-as-admin.ts'
import type { UpdateTvSource } from '../../../application/tv/update-tv-source.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal } from '../principal.ts'
import { noContent } from '../responses.ts'
import { validate } from '../validation.ts'
import {
  toAdminTvChannelDto,
  toAdminTvGroupDto,
  toAdminTvSessionDto,
  toAdminTvSourceDetailDto,
  toAdminTvSourceDto,
  toTvSourceSettings,
  toTvSourceSettingsPatch,
} from './tv-dto.ts'

/** Admin → TV (§29.7), mounted under `/api/v1/admin`. */
export const adminTvRoutes = ({
  listTvSources,
  createTvSource,
  getTvSource,
  updateTvSource,
  deleteTvSource,
  requestTvSourceRefresh,
  listTvSourceChannels,
  setTvGroupEnabled,
  setTvChannelEnabled,
  listLiveSessions,
  stopLiveSessionAsAdmin,
}: {
  listTvSources: ListTvSources
  createTvSource: CreateTvSource
  getTvSource: GetTvSource
  updateTvSource: UpdateTvSource
  deleteTvSource: DeleteTvSource
  requestTvSourceRefresh: RequestTvSourceRefresh
  listTvSourceChannels: ListTvSourceChannels
  setTvGroupEnabled: SetTvGroupEnabled
  setTvChannelEnabled: SetTvChannelEnabled
  listLiveSessions: ListLiveSessions
  stopLiveSessionAsAdmin: StopLiveSessionAsAdmin
}) =>
  new Hono<AppEnv>()
    .get('/tv/sources', (c) =>
      c.json(
        { items: listTvSources().map(toAdminTvSourceDto) } satisfies AdminTvSourcesResponse,
        200,
      ),
    )
    .post('/tv/sources', validate('json', createTvSourceBodySchema), (c) => {
      const { name, settings, maxConnections } = c.req.valid('json')
      const created = createTvSource({
        name,
        settings: toTvSourceSettings(settings),
        ...(maxConnections === undefined ? {} : { maxConnections }),
      })
      return created.ok
        ? c.json(toAdminTvSourceDto(created.value), 201)
        : respondError(c, created.error)
    })
    .get('/tv/sources/:id', (c) => {
      const result = getTvSource({ id: c.req.param('id') })
      return result.ok
        ? c.json(toAdminTvSourceDetailDto(result.value), 200)
        : respondError(c, result.error)
    })
    .patch('/tv/sources/:id', validate('json', updateTvSourceBodySchema), (c) => {
      const { name, settings, maxConnections } = c.req.valid('json')
      const result = updateTvSource({
        id: c.req.param('id'),
        ...(name === undefined ? {} : { name }),
        ...(settings === undefined
          ? {}
          : {
              settings: toTvSourceSettingsPatch(settings),
            }),
        ...(maxConnections === undefined
          ? {}
          : { maxConnections: maxConnections === '' ? 'none' : maxConnections }),
      })
      return result.ok
        ? c.json(toAdminTvSourceDto(result.value), 200)
        : respondError(c, result.error)
    })
    .delete('/tv/sources/:id', async (c) => {
      const result = await deleteTvSource({ id: c.req.param('id') })
      return result.ok ? noContent(c) : respondError(c, result.error)
    })
    .post('/tv/sources/:id/refresh', (c) => {
      const result = requestTvSourceRefresh({ id: c.req.param('id') })
      return result.ok
        ? c.json({ jobId: result.value.jobId } satisfies JobRef, 202)
        : respondError(c, result.error)
    })
    .get('/tv/sources/:id/channels', validate('query', adminTvChannelsQuerySchema), (c) => {
      const { q, groupId, cursor, limit } = c.req.valid('query')
      const result = listTvSourceChannels({
        sourceId: c.req.param('id'),
        ...(q === undefined ? {} : { q }),
        ...(groupId === undefined ? {} : { groupId }),
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      })
      if (!result.ok) return respondError(c, result.error)
      const { items, nextCursor, total } = result.value
      return c.json(
        {
          items: items.map(toAdminTvChannelDto),
          total,
          ...(nextCursor === undefined ? {} : { nextCursor }),
        } satisfies AdminTvChannelsPage,
        200,
      )
    })
    .patch('/tv/sources/:id/groups/:groupId', validate('json', setTvEnabledBodySchema), (c) => {
      const result = setTvGroupEnabled({
        sourceId: c.req.param('id'),
        groupId: c.req.param('groupId'),
        enabled: c.req.valid('json').enabled,
      })
      return result.ok
        ? c.json(toAdminTvGroupDto(result.value), 200)
        : respondError(c, result.error)
    })
    .patch('/tv/channels/:id', validate('json', setTvEnabledBodySchema), (c) => {
      const result = setTvChannelEnabled({
        id: c.req.param('id'),
        enabled: c.req.valid('json').enabled,
      })
      return result.ok
        ? c.json(toAdminTvChannelDto(result.value), 200)
        : respondError(c, result.error)
    })
    .get('/tv/sessions', (c) =>
      c.json(
        { items: listLiveSessions().map(toAdminTvSessionDto) } satisfies AdminTvSessionsResponse,
        200,
      ),
    )
    .delete('/tv/sessions/:id', (c) => {
      const stopped = stopLiveSessionAsAdmin({
        sessionId: c.req.param('id'),
        adminAccountId: currentPrincipal(c).account.id,
      })
      return stopped.ok ? noContent(c) : respondError(c, stopped.error)
    })

export type AdminTvRoutes = ReturnType<typeof adminTvRoutes>
