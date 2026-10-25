import { Hono } from 'hono'

import {
  createLibraryBodySchema,
  type LibraryDto,
  scanLibraryBodySchema,
  type ScanRunDto,
  scanRunsQuerySchema,
  updateLibraryBodySchema,
} from '@projo/shared/api/libraries'

import type { CreateLibraryInput } from '../../../application/library/create-library.ts'
import type { createLibraryFactory } from '../../../application/library/create-library.ts'
import type { deleteLibraryFactory } from '../../../application/library/delete-library.ts'
import type {
  LibraryView,
  LibraryViews,
  requestLibraryScanFactory,
} from '../../../application/library/library-views.ts'
import type { updateLibraryFactory } from '../../../application/library/update-library.ts'
import type { LibraryChanges } from '../../../core/library/library.ts'
import type { ScanRun } from '../../../core/scanner/ports.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'

export const toScanRunDto = (run: ScanRun): ScanRunDto => ({
  id: run.id,
  libraryId: run.libraryId,
  kind: run.kind,
  startedAt: run.startedAt.toISOString(),
  stats: run.stats,
  ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt.toISOString() }),
  ...(run.error === undefined ? {} : { error: run.error }),
})

export const toLibraryDto = (library: LibraryView): LibraryDto => ({
  id: library.id,
  name: library.name,
  hint: library.hint,
  scanIntervalMinutes: library.scanIntervalMinutes,
  watchEnabled: library.watchEnabled,
  quietPeriodSeconds: library.quietPeriodSeconds,
  detectSegments: library.detectSegments,
  preExtractSubtitles: library.preExtractSubtitles,
  trickplayEnabled: library.trickplayEnabled,
  ratingCountry: library.ratingCountry,
  createdAt: library.createdAt.toISOString(),
  ...(library.metadataLanguage === undefined ? {} : { metadataLanguage: library.metadataLanguage }),
  roots: library.roots.map((root) => ({
    id: root.id,
    path: root.path,
    state: root.state,
    lastFileCount: root.lastFileCount,
    ...(root.lastScanAt === undefined ? {} : { lastScanAt: root.lastScanAt.toISOString() }),
    ...(root.lastError === undefined ? {} : { lastError: root.lastError }),
  })),
  sourceCounts: library.sourceCounts,
  analysis: {
    waiting: library.analysis.waiting,
    verifying: library.analysis.verifying,
    failed: library.analysis.failed,
    ...(library.analysis.nextReadyAt === undefined
      ? {}
      : { nextReadyAt: library.analysis.nextReadyAt.toISOString() }),
  },
  ...(library.lastScan === undefined ? {} : { lastScan: toScanRunDto(library.lastScan) }),
})

/** Zod `.partial()` output → object without `undefined` values (`exactOptionalPropertyTypes`). */
const definedOnly = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }

type Deps = {
  views: LibraryViews
  createLibrary: ReturnType<typeof createLibraryFactory>
  updateLibrary: ReturnType<typeof updateLibraryFactory>
  deleteLibrary: ReturnType<typeof deleteLibraryFactory>
  requestLibraryScan: ReturnType<typeof requestLibraryScanFactory>
}

/**
 * §17.2 Admin librairies: `/libraries`, `/libraries/:id`, `/libraries/:id/scan`, `/libraries/:id/scans`.
 * Mounted at `/api/v1/admin`. Middleware: per route or path-scoped, never `.use('*')` (the sub-app is
 * mounted at a shared prefix, a wildcard would leak to every other domain).
 */
export const adminLibrariesRoutes = ({
  views,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  requestLibraryScan,
}: Deps) =>
  new Hono<AppEnv>()
    .get('/libraries', (c) => c.json({ items: views.list().map(toLibraryDto) }, 200))
    .post('/libraries', validate('json', createLibraryBodySchema), async (c) => {
      const body = c.req.valid('json')
      const { metadataLanguage, ...rest } = body
      const input: CreateLibraryInput = {
        ...rest,
        ...(metadataLanguage === undefined ? {} : { metadataLanguage }),
      }
      const result = await createLibrary(input)
      return result.ok
        ? c.json(toLibraryDto(views.toView(result.value)), 201)
        : respondError(c, result.error)
    })
    .get('/libraries/:id', (c) => {
      const result = views.get({ id: c.req.param('id') })
      return result.ok ? c.json(toLibraryDto(result.value), 200) : respondError(c, result.error)
    })
    .patch('/libraries/:id', validate('json', updateLibraryBodySchema), async (c) => {
      const { roots, metadataLanguage, ...rest } = c.req.valid('json')
      const changes: LibraryChanges = {
        ...definedOnly(rest),
        ...(metadataLanguage === undefined
          ? {}
          : { metadataLanguage: metadataLanguage === '' ? undefined : metadataLanguage }),
      }
      const result = await updateLibrary({
        id: c.req.param('id'),
        changes,
        ...(roots === undefined ? {} : { roots }),
      })
      return result.ok
        ? c.json(toLibraryDto(views.toView(result.value)), 200)
        : respondError(c, result.error)
    })
    .delete('/libraries/:id', async (c) => {
      const result = await deleteLibrary({ id: c.req.param('id') })
      return result.ok ? new Response(undefined, { status: 204 }) : respondError(c, result.error)
    })
    .post('/libraries/:id/scan', validate('json', scanLibraryBodySchema), (c) => {
      const result = requestLibraryScan({ id: c.req.param('id'), mode: c.req.valid('json').mode })
      return result.ok ? c.json(result.value, 202) : respondError(c, result.error)
    })
    .get('/libraries/:id/scans', validate('query', scanRunsQuerySchema), (c) => {
      const { cursor, limit } = c.req.valid('query')
      const result = views.scans({
        id: c.req.param('id'),
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      })
      return result.ok
        ? c.json(
            {
              items: result.value.items.map(toScanRunDto),
              ...(result.value.nextCursor === undefined
                ? {}
                : { nextCursor: result.value.nextCursor }),
            },
            200,
          )
        : respondError(c, result.error)
    })

export type AdminLibrariesRoutes = ReturnType<typeof adminLibrariesRoutes>
