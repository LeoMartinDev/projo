import type { RootErrorReason } from '@projo/shared/api/libraries'

import type { LibraryHint } from '../naming/index.ts'

/** Per-library settings (§6.2, §7.1). */
export type LibrarySettings = {
  hint: LibraryHint
  scanIntervalMinutes: number
  watchEnabled: boolean
  quietPeriodSeconds: number
  detectSegments: boolean
  preExtractSubtitles: boolean
  trickplayEnabled: boolean
  /** Absent: server setting. */
  metadataLanguage?: string
  ratingCountry: string
}

export type RootState = 'ok' | 'unreachable'

export type LibraryRoot = {
  id: string
  libraryId: string
  /** Absolute, normalized (no trailing slash). */
  path: string
  state: RootState
  lastScanAt?: Date
  /** Video files found by the last complete walk (feeds the §7.5 empty-root guard). */
  lastFileCount: number
  /** Why the root is `unreachable` (§7.5); cleared by its next complete walk. */
  lastError?: RootErrorReason
}

export type Library = LibrarySettings & {
  id: string
  name: string
  createdAt: Date
  roots: LibraryRoot[]
}

export type NewLibrary = LibrarySettings & {
  id: string
  name: string
  createdAt: Date
  roots: { id: string; path: string }[]
}

export type LibraryChanges = Partial<Omit<LibrarySettings, 'metadataLanguage'>> & {
  name?: string
  /** `undefined` value: cleared (server setting). Key absent: unchanged. */
  metadataLanguage?: string | undefined
}

/** Files about to leave their library: the library deleted, roots removed, sources purged. */
export type LeavingFiles =
  { libraryId: string } | { rootIds: readonly string[] } | { sourceIds: readonly string[] }

/**
 * Told when what a library's TMDB metadata is written with changes (§9.4): its metadata language,
 * its rating country, or the library deciding a movie or series (§9.1) when files leave. The
 * metadata domain queues the refresh of what became stale.
 */
export type LibraryMetadataContextObserver = {
  changed: (input: { libraryId: string; language: boolean; ratingCountry: boolean }) => void
  /**
   * Called before the files leave; the function it returns, called once they are gone, refreshes
   * the movies and series that held some of them and now resolve to other settings.
   */
  filesLeaving: (files: LeavingFiles) => () => void
}

/**
 * What a deleted library or removed root leaves outside its rows (no foreign key reaches them):
 * the jobs on it or on its sources, and the open notifications about it.
 */
export type LibraryLeftovers = {
  /**
   * Called before the rows go (its sources are found through them): deletes the `queued` jobs on
   * the library, or on a source of the roots (their work is moot), resolves the open notifications
   * about them (unreachable roots, layouts, stuck files) and returns the ids of the `running` jobs,
   * for the runner to abort.
   */
  clear: (scope: { libraryId: string } | { rootIds: readonly string[] }) => {
    runningJobIds: string[]
  }
}

export type RootChanges = {
  add: { id: string; path: string }[]
  /** Root ids; their sources go with them (cascade). */
  remove: string[]
}

/** Persistence of `libraries` + `library_roots`. Synchronous (bun:sqlite). */
export type LibraryRepository = {
  list: () => Library[]
  findById: (id: string) => Library | undefined
  /** Case-insensitive. */
  findByName: (name: string) => Library | undefined
  /** Every root of every library (overlap validation, watchers). */
  listRoots: () => LibraryRoot[]
  create: (library: NewLibrary) => Library
  update: (input: { id: string; changes: LibraryChanges; roots?: RootChanges }) => Library
  delete: (id: string) => void
  markRootScanned: (input: { rootId: string; at: Date; fileCount: number }) => void
  markRootUnreachable: (input: { rootId: string; at: Date; reason: RootErrorReason }) => void
}
