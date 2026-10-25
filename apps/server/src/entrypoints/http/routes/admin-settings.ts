import { Hono } from 'hono'

import { type AdminSettingsDto, updateAdminSettingsBodySchema } from '@projo/shared/api/settings'

import type {
  MetadataSettingsAdmin,
  MetadataSettingsView,
} from '../../../application/metadata/metadata-settings.ts'
import type {
  PlaybackSettingsAdmin,
  ServerSettingsAdmin,
} from '../../../application/operations/types.ts'
import type {
  SegmentSettingsAdmin,
  SegmentSettingsView,
} from '../../../application/segments/types.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'

type Sections = {
  metadata: MetadataSettingsAdmin
  segments: SegmentSettingsAdmin
  playback: PlaybackSettingsAdmin
  server: ServerSettingsAdmin
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

const toDto = ({ metadata, segments, playback, server }: Sections): AdminSettingsDto => {
  const current = playback.get()
  return {
    playback: {
      maxConcurrentTranscodes: current.maxConcurrentTranscodes,
      audioDownmix: current.audioDownmix,
      burnInEnabled: current.burnInEnabled,
      transcodeCacheMaxGb: current.transcodeCacheMaxGb,
      trickplayEnabled: current.trickplayEnabled,
    },
    metadata: toMetadataDto(metadata.get()),
    segments: toSegmentsDto(segments.get()),
    server: server.get(),
  }
}

/**
 * `GET/PATCH /admin/settings` (§17.2 Admin operations): sections "Playback", "Metadata",
 * "Intros and credits" and "Server" (§15). A PATCH applies its sections in that order and stops at the
 * first error. Mounted at `/api/v1/admin`.
 */
export const adminSettingsRoutes = (sections: Sections) =>
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

/** Zod's `.partial()` types absent keys as `T | undefined`; `exactOptionalPropertyTypes` wants them gone. */
const stripUndefined = <T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }

export type AdminSettingsRoutes = ReturnType<typeof adminSettingsRoutes>
