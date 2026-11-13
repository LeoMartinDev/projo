import { Hono } from 'hono'

import { type AdminSettingsDto, updateAdminSettingsBodySchema } from '@projo/shared/api/settings'

import type { GetMetadataSettings } from '../../../application/metadata/get-metadata-settings.ts'
import type { MetadataSettingsView } from '../../../application/metadata/shared/metadata-settings-view.ts'
import type { UpdateMetadataSettings } from '../../../application/metadata/update-metadata-settings.ts'
import type { GetPlaybackSettings } from '../../../application/operations/get-playback-settings.ts'
import type { GetServerSettings } from '../../../application/operations/get-server-settings.ts'
import type { UpdatePlaybackSettings } from '../../../application/operations/update-playback-settings.ts'
import type { UpdateServerSettings } from '../../../application/operations/update-server-settings.ts'
import type { GetSegmentSettings } from '../../../application/segments/get-segment-settings.ts'
import type { SegmentSettingsView } from '../../../application/segments/shared/segment-settings-view.ts'
import type { UpdateSegmentSettings } from '../../../application/segments/update-segment-settings.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'

/** One section per owning module: metadata, segments, operations (playback and server). */
export type AdminSettingsSections = {
  metadata: { get: GetMetadataSettings; update: UpdateMetadataSettings }
  segments: { get: GetSegmentSettings; update: UpdateSegmentSettings }
  playback: { get: GetPlaybackSettings; update: UpdatePlaybackSettings }
  server: { get: GetServerSettings; update: UpdateServerSettings }
}

const toMetadataDto = (metadata: MetadataSettingsView): AdminSettingsDto['metadata'] => ({
  language: metadata.language,
  tmdbApiKey: {
    configured: metadata.tmdbApiKey.configured,
    state: metadata.tmdbApiKey.state,
    ...(metadata.tmdbApiKey.last4 === undefined ? {} : { last4: metadata.tmdbApiKey.last4 }),
  },
})

const toSegmentsDto = (segments: SegmentSettingsView): AdminSettingsDto['segments'] => ({
  providers: segments.providers,
  theintrodbApiKey: {
    configured: segments.theintrodbApiKey.configured,
    ...(segments.theintrodbApiKey.last4 === undefined
      ? {}
      : { last4: segments.theintrodbApiKey.last4 }),
  },
  fingerprint: segments.fingerprint,
  contribution: segments.contribution,
})

const toDto = ({
  metadata,
  segments,
  playback,
  server,
}: AdminSettingsSections): AdminSettingsDto => {
  const current = playback.get()
  return {
    playback: {
      maxConcurrentTranscodes: current.maxConcurrentTranscodes,
      audioDownmix: current.audioDownmix,
      burnInEnabled: current.burnInEnabled,
      transcodeCacheMaxGb: current.transcodeCacheMaxGb,
      trickplayEnabled: current.trickplayEnabled,
      hwAccel: current.hwAccel,
    },
    metadata: toMetadataDto(metadata.get()),
    segments: toSegmentsDto(segments.get()),
    server: server.get(),
  }
}

export const adminSettingsRoutes = (sections: AdminSettingsSections) =>
  new Hono<AppEnv>()
    .get('/settings', (c) => c.json(toDto(sections), 200))
    .patch('/settings', validate('json', updateAdminSettingsBodySchema), async (c) => {
      const { metadata, segments, playback, server } = sections
      const body = c.req.valid('json')
      if (body.playback !== undefined) playback.update(stripUndefined(body.playback))
      if (body.metadata !== undefined) {
        const { language, tmdbApiKey } = body.metadata
        const result = await metadata.update({
          ...(language === undefined ? {} : { language }),
          ...(tmdbApiKey === undefined ? {} : { tmdbApiKey }),
        })
        if (!result.ok) return respondError(c, result.error)
      }
      if (body.segments !== undefined) {
        const { providers, theintrodbApiKey, fingerprint, contribution } = body.segments
        const result = await segments.update({
          ...(providers === undefined ? {} : { providers }),
          ...(theintrodbApiKey === undefined ? {} : { theintrodbApiKey }),
          ...(fingerprint === undefined ? {} : { fingerprint: stripUndefined(fingerprint) }),
          ...(contribution === undefined ? {} : { contribution }),
        })
        if (!result.ok) return respondError(c, result.error)
      }
      if (body.server?.name !== undefined) server.update({ name: body.server.name })
      return c.json(toDto(sections), 200)
    })

const stripUndefined = <T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }

export type AdminSettingsRoutes = ReturnType<typeof adminSettingsRoutes>
