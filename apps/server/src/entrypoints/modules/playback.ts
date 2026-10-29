import { z } from 'zod'

import { ok } from '@projo/shared'

import { cleanupCacheFactory } from '../../application/playback/cleanup-cache.ts'
import { createPlaybackSessionFactory } from '../../application/playback/create-session.ts'
import { directStreamFactory } from '../../application/playback/direct-stream.ts'
import { hlsStreamFactory } from '../../application/playback/hls-stream.ts'
import { trickplayUrlFactory } from '../../application/playback/trickplay.ts'
import {
  indexKeyframesFactory,
  keyframePriority,
  requestKeyframes,
} from '../../application/playback/index-keyframes.ts'
import {
  authorizePlaybackFactory,
  authorizeStreamFactory,
  endPlaybackSessionFactory,
  endPlaybackSessionsWithinFactory,
  heartbeatFactory,
  type ItemVisibility,
  stopPlaybackSessionFactory,
  sweepPlaybackSessionsFactory,
} from '../../application/playback/session-lifecycle.ts'
import {
  clearTrackPreferencesFactory,
  setTrackPreferencesFactory,
} from '../../application/playback/track-preferences.ts'
import { type PlaybackSessionTerminator, sessionTimings } from '../../core/playback/session.ts'
import { sessionTokens } from '../../infrastructure/auth/session-tokens.ts'
import { createFfprobe } from '../../infrastructure/playback/ffprobe.ts'
import {
  createHlsSegmenter,
  createTranscodeCache,
} from '../../infrastructure/playback/hls-segmenter.ts'
import { createFileKeyframeStore } from '../../infrastructure/playback/keyframe-store.ts'
import { createMediaFiles } from '../../infrastructure/playback/media-files.ts'
import { createTrickplayStore } from '../../infrastructure/playback/trickplay-store.ts'
import { createSqliteAdminNotifier } from '../../infrastructure/sqlite/admin-notifier.ts'
import { createSqliteCatalogRepository } from '../../infrastructure/sqlite/catalog-repository.ts'
import { createSqlitePlaybackSessionRepository } from '../../infrastructure/sqlite/playback-session-repository.ts'
import { createSqlitePlaybackSettings } from '../../infrastructure/sqlite/playback-settings.ts'
import { createSqliteProfileRepository } from '../../infrastructure/sqlite/profile-repository.ts'
import { createSqliteProgressRepository } from '../../infrastructure/sqlite/progress-repository.ts'
import { createSqliteSubtitleTrackRepository } from '../../infrastructure/sqlite/subtitle-track-repository.ts'
import { createSqliteTrackPreferenceRepository } from '../../infrastructure/sqlite/track-preference-repository.ts'
import { playbackRoutes } from '../http/routes/playback.ts'
import { streamRoutes } from '../http/routes/stream.ts'
import { defineJobHandler } from '../jobs/handler.ts'
import { allVisible, type ScopeDeps } from './catalog.ts'
import type { Platform } from './platform.ts'

/**
 * Wiring of playback (§10): sessions, heartbeats, `direct`, `hls_remux` and `hls_transcode`
 * streams, keyframe index (`index_keyframes`), session expiry and cache purge, transcode cache cap
 * (`cleanup_cache`), ffmpeg shutdown.
 */
export const buildPlaybackModule = (
  { db, clock, ids, logger, eventBus, jobQueue, paths }: Platform,
  { visibilityScope = allVisible }: ScopeDeps = {},
) => {
  const catalogRepository = createSqliteCatalogRepository({ db })
  const progressRepository = createSqliteProgressRepository({ db })
  const sessionRepository = createSqlitePlaybackSessionRepository({ db })
  const subtitleTrackRepository = createSqliteSubtitleTrackRepository({ db })
  const trackPreferenceRepository = createSqliteTrackPreferenceRepository({ db })
  const profileRepository = createSqliteProfileRepository({ db })
  const playbackSettings = createSqlitePlaybackSettings({ db })
  const ffprobe = createFfprobe()
  // §18: background `index_keyframes` (after a scan) at the lowest CPU priority; the one a
  // player waits for (priority `interactive`) keeps the normal one.
  const backgroundFfprobe = createFfprobe({ processPriority: 'background' })
  const keyframeStore = createFileKeyframeStore({ keyframesDir: paths.cache.keyframes })
  const segmenter = createHlsSegmenter({
    transcodeDir: paths.cache.transcode,
    logger,
    notifier: createSqliteAdminNotifier({ db, ids, clock, eventBus }),
  })
  const transcodeCache = createTranscodeCache({ transcodeDir: paths.cache.transcode })
  const trickplayUrl = trickplayUrlFactory({
    catalogRepository,
    trickplayStore: createTrickplayStore({ trickplayDir: paths.cache.trickplay }),
  })

  const endSession = endPlaybackSessionFactory({
    sessionRepository,
    segmenter,
    eventBus,
    clock,
    logger,
    onEnded: (sessionId) => hlsStream.forget(sessionId),
  })
  const isItemVisible: ItemVisibility = ({ itemId, profileId }) =>
    catalogRepository.findVisible({ id: itemId, scope: visibilityScope(profileId) }) !== undefined
  const authorize = authorizePlaybackFactory({
    sessionRepository,
    endSession,
    isItemVisible,
    clock,
  })
  const authorizeStream = authorizeStreamFactory({
    sessionRepository,
    endSession,
    hashSecret: sessionTokens.hash,
    clock,
  })
  const hlsStream = hlsStreamFactory({
    authorize: authorizeStream,
    catalogRepository,
    keyframeStore,
    mediaProber: ffprobe,
    jobQueue,
    segmenter,
    subtitleTrackRepository,
    playbackSettings,
    delay: (ms) => Bun.sleep(ms),
  })
  const indexKeyframes = indexKeyframesFactory({
    catalogRepository,
    keyframeStore,
    keyframeExtractor: ffprobe,
    mediaProber: ffprobe,
    logger,
  })
  const indexKeyframesInBackground = indexKeyframesFactory({
    catalogRepository,
    keyframeStore,
    keyframeExtractor: backgroundFfprobe,
    mediaProber: backgroundFfprobe,
    logger,
  })
  const sweep = sweepPlaybackSessionsFactory({
    sessionRepository,
    transcodeCache,
    endSession,
    streams: {
      sessionIds: () => [...new Set([...segmenter.sessionIds(), ...hlsStream.sessionIds()])],
      release: (sessionId) => {
        segmenter.stop(sessionId)
        hlsStream.forget(sessionId)
      },
    },
    clock,
    logger,
  })
  const cleanupCache = cleanupCacheFactory({
    sessionRepository,
    transcodeCache,
    playbackSettings,
    logger,
  })
  const playbackSessions: PlaybackSessionTerminator = {
    endWithin: endPlaybackSessionsWithinFactory({ sessionRepository, endSession }),
  }

  // §10.3: background indexing once a source is ready, so most first plays find it done.
  const unsubscribe = eventBus.subscribe((event) => {
    if (event.type === 'source.ready') {
      requestKeyframes(jobQueue, event.payload.sourceId, keyframePriority.background)
    }
  })

  return {
    /** For the media-assets module: subtitle renditions under the capability URLs (§20). */
    authorizeStream,
    /** For the libraries and scanner modules (§10.6). */
    playbackSessions,
    /** For the admin playback module: "Stop" (§10.6, reason `admin`). */
    endSession,
    routes: playbackRoutes({
      createPlaybackSession: createPlaybackSessionFactory({
        catalogRepository,
        progressRepository,
        sessionRepository,
        subtitleTrackRepository,
        trackPreferenceRepository,
        trickplayReady: (sourceId) => trickplayUrl(sourceId) !== undefined,
        streamSecrets: sessionTokens,
        // §11.1 settings of the profile, for the §11.2 cascade.
        profileTracks: (profileId) => {
          const profile = profileRepository.findById(profileId)
          return (
            profile && {
              audioLanguage: profile.audioLanguage,
              subtitleLanguage: profile.subtitleLanguage,
              subtitleMode: profile.subtitleMode,
              animeOriginalAudio: profile.animeOriginalAudio,
            }
          )
        },
        playbackSettings,
        mediaProber: ffprobe,
        keyframeStore,
        jobQueue,
        clock,
        ids,
        logger,
      }),
      heartbeat: heartbeatFactory({
        authorize,
        sessionRepository,
        catalogRepository,
        progressRepository,
        clock,
      }),
      stopPlaybackSession: stopPlaybackSessionFactory({
        sessionRepository,
        endSession,
        isItemVisible,
      }),
      setTrackPreferences: setTrackPreferencesFactory({
        catalogRepository,
        trackPreferenceRepository,
        clock,
        logger,
      }),
      clearTrackPreferences: clearTrackPreferencesFactory({
        catalogRepository,
        trackPreferenceRepository,
      }),
      scopeFor: visibilityScope,
    }),
    streamRoutes: streamRoutes({
      directStream: directStreamFactory({ authorize: authorizeStream, catalogRepository }),
      hlsStream,
      mediaFiles: createMediaFiles(),
    }),
    jobHandlers: {
      index_keyframes: defineJobHandler({
        payload: z.object({ sourceId: z.string().min(1) }),
        concurrency: 1,
        run: async ({ sourceId }, { signal, job }) => {
          // A queued job takes the highest priority of its requests (`enqueue`).
          const index =
            job.priority >= keyframePriority.interactive
              ? indexKeyframes
              : indexKeyframesInBackground
          const indexed = await index({ sourceId, signal })
          // A source gone since the job was queued: nothing left to do.
          if (indexed.ok || indexed.error.code === 'playback/source_unavailable') return ok()
          return indexed
        },
      }),
      // §10.3, §18: singleton (dedupe key), hourly.
      cleanup_cache: defineJobHandler({
        payload: z.object({}),
        concurrency: 1,
        run: async () => {
          cleanupCache()
          return ok()
        },
      }),
    },
    scheduledTasks: [
      {
        name: 'playback-sessions-sweep',
        intervalMs: sessionTimings.heartbeatIntervalMs,
        run: () => {
          sweep()
        },
      },
      {
        name: 'cleanup-cache',
        intervalMs: 60 * 60_000,
        initialDelayMs: 60_000,
        run: () => {
          jobQueue.enqueue({ type: 'cleanup_cache', payload: {}, dedupeKey: 'cleanup_cache' })
        },
      },
    ],
    stop: async () => {
      unsubscribe()
      await segmenter.stopAll()
    },
  }
}
