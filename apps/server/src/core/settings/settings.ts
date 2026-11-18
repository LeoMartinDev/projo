export const settingKeys = {
  serverName: 'server.name',
  metadataLanguage: 'metadata.language',
  tmdbApiKey: 'metadata.tmdb_api_key',
  tmdbApiKeyRejectedAt: 'metadata.tmdb_api_key_rejected_at',
  audioDownmix: 'playback.audio_downmix',
  maxConcurrentTranscodes: 'playback.max_concurrent_transcodes',
  transcodeCacheMaxGb: 'playback.transcode_cache_max_gb',
  burnInEnabled: 'playback.burn_in_enabled',
  trickplayEnabled: 'playback.trickplay_enabled',
  hwAccel: 'playback.hw_accel',
  liveWindowMinutes: 'playback.live_window_minutes',
  liveCacheMaxGb: 'playback.live_cache_max_gb',
  segmentProviders: 'segments.providers',
  theintrodbApiKey: 'segments.theintrodb_api_key',
  skipdbAnonymousKey: 'segments.skipdb_anonymous_key',
  fingerprintEnabled: 'segments.fingerprint_enabled',
  fingerprintIntroMinutes: 'segments.fingerprint_intro_minutes',
  fingerprintCreditsMinutes: 'segments.fingerprint_credits_minutes',
  fingerprintMinSeconds: 'segments.fingerprint_min_seconds',
  fingerprintMaxSeconds: 'segments.fingerprint_max_seconds',
  fingerprintSimilarity: 'segments.fingerprint_similarity',
  segmentContribution: 'segments.contribution',
  updateChannel: 'updates.channel',
  updateLastCheck: 'updates.last_check',
  namingRulesVersion: 'scanner.naming_rules_version',
  needsReviewNotifiedAt: 'notifications.needs_review_notified_at',
  mediaKeySecret: 'auth.media_key_secret',
} as const

export type SettingKey = (typeof settingKeys)[keyof typeof settingKeys]

export type SettingsRepository = {
  get: (key: SettingKey) => unknown
}

export type PlaybackSettings = {
  audioDownmix: 'stereo' | 'keep'
  maxConcurrentTranscodes: number
  transcodeCacheMaxGb: number
  burnInEnabled: boolean
  trickplayEnabled: boolean
  hwAccel: 'off' | 'vaapi'
  /** The live TV replay window (§29.4), in minutes. */
  liveWindowMinutes: number
  /** The cap of the live TV cache (§29.4), in GB. */
  liveCacheMaxGb: number
}

export const defaultPlaybackSettings: PlaybackSettings = {
  audioDownmix: 'stereo',
  maxConcurrentTranscodes: 2,
  transcodeCacheMaxGb: 10,
  burnInEnabled: true,
  trickplayEnabled: true,
  hwAccel: 'off',
  liveWindowMinutes: 30,
  liveCacheMaxGb: 20,
}

export type PlaybackSettingsReader = { read: () => PlaybackSettings }

export type PlaybackSettingsWriter = {
  write: (input: { values: Partial<PlaybackSettings>; at: Date }) => void
}

export const defaultServerName = 'projo'

export type ServerNameStore = {
  read: () => string
  write: (input: { name: string; at: Date }) => void
}

export type SegmentSettings = {
  providers: ('theintrodb' | 'introdb' | 'skipdb')[]
  theintrodbApiKey?: string
  skipdbAnonymousKey?: string
  fingerprint: {
    enabled: boolean
    introMinutes: number
    creditsMinutes: number
    minSeconds: number
    maxSeconds: number
    similarity: number
  }
  contribution: 'off' | 'manual_only'
}

export const defaultSegmentSettings: SegmentSettings = {
  providers: ['theintrodb', 'introdb', 'skipdb'],
  fingerprint: {
    enabled: true,
    introMinutes: 10,
    creditsMinutes: 5,
    minSeconds: 15,
    maxSeconds: 150,
    similarity: 0.8,
  },
  contribution: 'off',
}

export type SegmentSettingsReader = { read: () => SegmentSettings }
