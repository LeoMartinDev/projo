/**
 * Keys of the `settings` table (§5.4: everything that is not an environment variable).
 * Values are JSON; each reader validates its own key.
 */
export const settingKeys = {
  serverName: 'server.name',
  metadataLanguage: 'metadata.language',
  /** TMDB v3 key or v4 read token (§9.1); never sent back to clients. */
  tmdbApiKey: 'metadata.tmdb_api_key',
  /** When TMDB last answered 401 to the stored key; cleared when a key is set (§15). */
  tmdbApiKeyRejectedAt: 'metadata.tmdb_api_key_rejected_at',
  // §10.2 – §10.5 playback settings (admin screen in M5; read with their defaults until then).
  audioDownmix: 'playback.audio_downmix',
  maxConcurrentTranscodes: 'playback.max_concurrent_transcodes',
  transcodeCacheMaxGb: 'playback.transcode_cache_max_gb',
  burnInEnabled: 'playback.burn_in_enabled',
  trickplayEnabled: 'playback.trickplay_enabled',
  /** Not exposed in v1 (§10.3): the ffmpeg argument builders already take it. */
  hwAccel: 'playback.hw_accel',
  // §12 intros and credits (admin screen §15 "Intros and credits").
  /** Enabled community providers, in the order they are asked (§12.2). */
  segmentProviders: 'segments.providers',
  /** Optional TheIntroDB key (§12.2: higher limits; required to contribute); never sent back. */
  theintrodbApiKey: 'segments.theintrodb_api_key',
  /** SkipDB anonymous key, created on the first contribution (§12.5). */
  skipdbAnonymousKey: 'segments.skipdb_anonymous_key',
  fingerprintEnabled: 'segments.fingerprint_enabled',
  fingerprintIntroMinutes: 'segments.fingerprint_intro_minutes',
  fingerprintCreditsMinutes: 'segments.fingerprint_credits_minutes',
  fingerprintMinSeconds: 'segments.fingerprint_min_seconds',
  fingerprintMaxSeconds: 'segments.fingerprint_max_seconds',
  fingerprintSimilarity: 'segments.fingerprint_similarity',
  segmentContribution: 'segments.contribution',
  // §16 updates.
  /** Release channel; only `stable` in v1 (§16.4: exists for v2). */
  updateChannel: 'updates.channel',
  /** Result of the last `check_updates` (`UpdateCheckRecord`): survives restarts. */
  updateLastCheck: 'updates.last_check',
  // §7.4 scans.
  /** Version of the name analysis rules the names were last read with (`NAMING_RULES_VERSION`). */
  namingRulesVersion: 'scanner.naming_rules_version',
  // §15 notifications.
  /** When `scan/needs_review_count` was last raised (daily while "To review" is not empty). */
  needsReviewNotifiedAt: 'notifications.needs_review_notified_at',
} as const

export type SettingKey = (typeof settingKeys)[keyof typeof settingKeys]

export type SettingsRepository = {
  get: (key: SettingKey) => unknown
}

/** §10 playback settings, as the use cases read them (defaults of §24 when unset or invalid). */
export type PlaybackSettings = {
  audioDownmix: 'stereo' | 'keep'
  maxConcurrentTranscodes: number
  transcodeCacheMaxGb: number
  burnInEnabled: boolean
  trickplayEnabled: boolean
  hwAccel: 'off' | 'vaapi' | 'qsv'
}

export const defaultPlaybackSettings: PlaybackSettings = {
  audioDownmix: 'stereo',
  maxConcurrentTranscodes: 2,
  transcodeCacheMaxGb: 10,
  burnInEnabled: true,
  trickplayEnabled: true,
  hwAccel: 'off',
}

/** Read on every use: a change applies to the next session or job without a restart. */
export type PlaybackSettingsReader = { read: () => PlaybackSettings }

/** §15 "Playback": what the admin edits (`hwAccel` is not exposed in v1). */
export type EditablePlaybackSettings = Omit<PlaybackSettings, 'hwAccel'>

/** Writes the given playback keys (`settings` table); the reader sees them at once. */
export type PlaybackSettingsWriter = {
  write: (input: { values: Partial<EditablePlaybackSettings>; at: Date }) => void
}

/** §15 "Server": the name shown on the login and invitation pages (`server.name`). */
export const defaultServerName = 'projo'

export type ServerNameStore = {
  /** `defaultServerName` when unset. */
  read: () => string
  write: (input: { name: string; at: Date }) => void
}

/** §12 intros and credits settings, as the use cases read them (defaults of §24 when unset or invalid). */
export type SegmentSettings = {
  /** Enabled providers, in order; an absent provider is disabled. */
  providers: ('theintrodb' | 'introdb' | 'skipdb')[]
  theintrodbApiKey?: string
  skipdbAnonymousKey?: string
  fingerprint: {
    enabled: boolean
    /** Audio fingerprinted at the start of each episode, for `intro` (§12.3 `N`). */
    introMinutes: number
    /** Audio fingerprinted at the end of each episode, for `credits` (§12.3 `M`). */
    creditsMinutes: number
    /** Shortest and longest common sequence kept (§12.3: 15 s to 150 s). */
    minSeconds: number
    maxSeconds: number
    /**
     * Share of identical bits two 32-bit sub-fingerprints need to count as the same audio
     * (1 − Hamming distance / 32); documented with the algorithm in `core/segments/fingerprint.ts`.
     */
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

/** Read on every use, like `PlaybackSettingsReader`. */
export type SegmentSettingsReader = { read: () => SegmentSettings }
