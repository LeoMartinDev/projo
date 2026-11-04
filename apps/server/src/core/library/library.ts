import type { RootErrorReason } from '@projo/shared/api/libraries'

import type { LibraryHint } from '../naming/index.ts'

export type LibrarySettings = {
  hint: LibraryHint
  scanIntervalMinutes: number
  watchEnabled: boolean
  quietPeriodSeconds: number
  detectSegments: boolean
  preExtractSubtitles: boolean
  trickplayEnabled: boolean
  metadataLanguage?: string
  ratingCountry: string
}

export type RootState = 'ok' | 'unreachable'

export type LibraryRoot = {
  id: string
  libraryId: string
  path: string
  state: RootState
  lastScanAt?: Date
  lastFileCount: number
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
  metadataLanguage?: string | undefined
}

export type LeavingFiles =
  { libraryId: string } | { rootIds: readonly string[] } | { sourceIds: readonly string[] }

export type LibraryMetadataContextObserver = {
  changed: (input: { libraryId: string; language: boolean; ratingCountry: boolean }) => void
  filesLeaving: (files: LeavingFiles) => () => void
}

export type LibraryLeftovers = {
  clear: (scope: { libraryId: string } | { rootIds: readonly string[] }) => {
    runningJobIds: string[]
  }
}

export type RootChanges = {
  add: { id: string; path: string }[]
  remove: string[]
}

export type LibraryRepository = {
  list: () => Library[]
  findById: (id: string) => Library | undefined
  findByName: (name: string) => Library | undefined
  listRoots: () => LibraryRoot[]
  create: (library: NewLibrary) => Library
  update: (input: { id: string; changes: LibraryChanges; roots?: RootChanges }) => Library
  delete: (id: string) => void
  markRootScanned: (input: { rootId: string; at: Date; fileCount: number }) => void
  markRootUnreachable: (input: { rootId: string; at: Date; reason: RootErrorReason }) => void
}
