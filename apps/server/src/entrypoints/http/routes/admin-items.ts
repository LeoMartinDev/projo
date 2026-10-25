import { Hono } from 'hono'
import { z } from 'zod'

import { appError, type AppError, err, fromPromise, ok, type Result } from '@projo/shared'
import type { JobRef } from '@projo/shared/api/jobs'
import {
  type AssignResponse,
  assignBodySchema,
  chooseItemImageBodySchema,
  imageAlternativesQuerySchema,
  type ImageAlternativesResponse,
  type ItemMetadataDto,
  maxImageUploadBytes,
  overrideFieldParamSchema,
  type TmdbPreviewSize,
  tmdbPreviewSizeSchema,
  type TmdbSearchResponse,
  tmdbSearchQuerySchema,
  updateItemMetadataBodySchema,
  uploadItemImageFormSchema,
} from '@projo/shared/api/metadata'

import type {
  ImageChoice,
  ItemMetadataView,
  MetadataEditing,
} from '../../../application/metadata/editing-types.ts'
import type { Review } from '../../../application/metadata/review.ts'
import type { TmdbError } from '../../../core/metadata/tmdb.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { parseJson, validate } from '../validation.ts'

/** `DELETE /items/:id/overrides/:field`: both path params, so the RPC client types the id. */
const overrideParamSchema = overrideFieldParamSchema.extend({ id: z.string().min(1) })

const posterFileSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/u),
})

/** w185 by default (search results, poster alternatives); w300 for backdrop alternatives. */
const posterSizeSchema = z.object({ size: tmdbPreviewSizeSchema.default('w185') })

export type TmdbPosterProxy = (
  path: string,
  size: TmdbPreviewSize,
) => Promise<Result<{ bytes: Uint8Array; contentType: string }, TmdbError>>

const imageUrl = (id: string | undefined) => (id === undefined ? undefined : `/api/v1/images/${id}`)

export const toItemMetadataDto = (item: ItemMetadataView): ItemMetadataDto => {
  const poster = imageUrl(item.posterImageId)
  const backdrop = imageUrl(item.backdropImageId)
  return {
    id: item.id,
    kind: item.kind,
    ...(item.tmdbId === undefined ? {} : { tmdbId: item.tmdbId }),
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.year === undefined ? {} : { year: item.year }),
    ...(item.overview === undefined ? {} : { overview: item.overview }),
    genres: item.genres,
    images: {
      ...(poster === undefined ? {} : { poster }),
      ...(backdrop === undefined ? {} : { backdrop }),
    },
    locked: item.locked,
    ...(item.metadataRefreshedAt === undefined
      ? {}
      : { metadataRefreshedAt: item.metadataRefreshedAt.toISOString() }),
  }
}

type ChoiceError = AppError<'common/validation_failed' | 'image/too_large'>

/** Room for the multipart boundaries, headers and the `kind` field around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/**
 * `POST /admin/items/:id/images` body: JSON (TMDB alternative) or multipart (upload). The size is
 * checked on the declared file size before its bytes are read (§9.3: 10 MB).
 */
const readImageChoice = async (request: Request): Promise<Result<ImageChoice, ChoiceError>> => {
  const invalid = (issues: unknown) =>
    err(
      appError('common/validation_failed', 'invalid request body', {
        context: { target: 'body', issues },
      }),
    )
  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    // `formData()` buffers the whole body: a declared length past the limit (plus the multipart
    // framing) is refused before reading it.
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > maxImageUploadBytes + MULTIPART_OVERHEAD_BYTES) {
      return err(
        appError('image/too_large', 'uploaded image too large', {
          context: { sizeBytes: declared, maxBytes: maxImageUploadBytes },
        }),
      )
    }
    const form = await fromPromise(
      () => request.formData(),
      (cause) => appError('common/validation_failed', 'invalid multipart body', { cause }),
    )
    if (!form.ok) return form
    const parsed = uploadItemImageFormSchema.safeParse({
      kind: form.value.get('kind'),
      file: form.value.get('file'),
    })
    if (!parsed.success) return invalid(parsed.error.issues)
    const { kind, file } = parsed.data
    if (file.size > maxImageUploadBytes) {
      return err(
        appError('image/too_large', 'uploaded image too large', {
          context: { sizeBytes: file.size, maxBytes: maxImageUploadBytes },
        }),
      )
    }
    const bytes = await fromPromise(
      async () => new Uint8Array(await file.arrayBuffer()),
      (cause) => appError('common/validation_failed', 'unreadable upload', { cause }),
    )
    return bytes.ok ? ok({ kind, upload: { bytes: bytes.value, sizeBytes: file.size } }) : bytes
  }
  const text = await fromPromise(
    () => request.text(),
    (cause) => appError('common/validation_failed', 'unreadable body', { cause }),
  )
  if (!text.ok) return text
  const json = await parseJson(text.value)
  if (!json.ok) return json
  const parsed = chooseItemImageBodySchema.safeParse(json.value)
  return parsed.success ? ok(parsed.data) : invalid(parsed.error.issues)
}

/**
 * §17.2 Admin items: TMDB search for "To review" and "Fix the match",
 * re-identification of an item (M2); editing with locks, images, refresh (§9.3, §9.4, M5), and
 * "Refresh the whole library" (`/libraries/:id/refresh-metadata`). Mounted at `/api/v1/admin`.
 */
export const adminItemsRoutes = ({
  review,
  tmdbPoster,
  editing,
}: {
  review: Review
  tmdbPoster: TmdbPosterProxy
  editing: MetadataEditing
}) =>
  new Hono<AppEnv>()
    .get('/tmdb/search', validate('query', tmdbSearchQuerySchema), async (c) => {
      const { q, kind, year, language } = c.req.valid('query')
      const result = await review.search({
        query: q,
        kind,
        ...(year === undefined ? {} : { year }),
        ...(language === undefined ? {} : { language }),
      })
      if (!result.ok) return respondError(c, result.error)
      const body: TmdbSearchResponse = {
        items: result.value.map((hit) => ({
          tmdbId: hit.tmdbId,
          kind,
          title: hit.title,
          popularity: hit.popularity,
          ...(hit.originalTitle === undefined ? {} : { originalTitle: hit.originalTitle }),
          ...(hit.year === undefined ? {} : { year: hit.year }),
          ...(hit.overview === undefined ? {} : { overview: hit.overview }),
          ...(hit.posterPath === undefined ? {} : { posterPath: hit.posterPath }),
        })),
      }
      return c.json(body, 200)
    })
    /**
     * Search result posters (w185) proxied by the server: the web never loads TMDB directly
     * (§9.1 "never hotlinked", strict CSP).
     */
    .get(
      '/tmdb/posters/:file',
      validate('param', posterFileSchema),
      validate('query', posterSizeSchema),
      async (c) => {
        const result = await tmdbPoster(`/${c.req.valid('param').file}`, c.req.valid('query').size)
        if (!result.ok) {
          return result.error.code === 'metadata/tmdb_not_found'
            ? respondError(c, appError('catalog/image_not_found', 'image not found'))
            : respondError(c, result.error)
        }
        return new Response(new Uint8Array(result.value.bytes), {
          status: 200,
          headers: {
            'Content-Type': result.value.contentType,
            'Cache-Control': 'private, max-age=86400',
          },
        })
      },
    )
    .post('/items/:id/rematch', validate('json', assignBodySchema), async (c) => {
      const account = c.get('account')
      if (account === undefined) throw new Error('admin route without account')
      const result = await review.rematchItem({
        itemId: c.req.param('id'),
        assignment: c.req.valid('json'),
        accountId: account.id,
      })
      return result.ok
        ? c.json(result.value satisfies AssignResponse, 200)
        : respondError(c, result.error)
    })
    // ── §9.3 editing, §9.4 refresh (M5) ──
    .get('/items/:id', (c) => {
      const result = editing.get({ itemId: c.req.param('id') })
      return result.ok
        ? c.json(toItemMetadataDto(result.value), 200)
        : respondError(c, result.error)
    })
    .patch('/items/:id', validate('json', updateItemMetadataBodySchema), (c) => {
      const { title, year, overview, genres } = c.req.valid('json')
      const result = editing.setOverrides({
        itemId: c.req.param('id'),
        overrides: {
          ...(title === undefined ? {} : { title }),
          ...(year === undefined ? {} : { year }),
          ...(overview === undefined ? {} : { overview }),
          ...(genres === undefined ? {} : { genres }),
        },
      })
      return result.ok
        ? c.json(toItemMetadataDto(result.value), 200)
        : respondError(c, result.error)
    })
    .delete('/items/:id/overrides/:field', validate('param', overrideParamSchema), async (c) => {
      const result = await editing.removeOverride({
        itemId: c.req.valid('param').id,
        field: c.req.valid('param').field,
      })
      return result.ok
        ? c.json(toItemMetadataDto(result.value), 200)
        : respondError(c, result.error)
    })
    .post('/items/:id/refresh', (c) => {
      const result = editing.requestRefresh({ itemId: c.req.param('id') })
      return result.ok
        ? c.json({ jobId: result.value.id } satisfies JobRef, 202)
        : respondError(c, result.error)
    })
    .get(
      '/items/:id/images/alternatives',
      validate('query', imageAlternativesQuerySchema),
      async (c) => {
        const result = await editing.alternatives({
          itemId: c.req.param('id'),
          kind: c.req.valid('query').kind,
        })
        if (!result.ok) return respondError(c, result.error)
        const body: ImageAlternativesResponse = {
          items: result.value.map((image) => ({
            tmdbPath: image.tmdbPath,
            width: image.width,
            height: image.height,
            current: image.current,
            ...(image.language === undefined ? {} : { language: image.language }),
            ...(image.voteAverage === undefined ? {} : { voteAverage: image.voteAverage }),
          })),
        }
        return c.json(body, 200)
      },
    )
    /**
     * JSON `{ kind, tmdbPath }` (TMDB alternative) or `multipart/form-data` `kind` + `file`
     * (upload): no validator, read by `readImageChoice`; the web posts both with `fetch`.
     */
    .post('/items/:id/images', async (c) => {
      const itemId = c.req.param('id')
      const choice = await readImageChoice(c.req.raw)
      if (!choice.ok) return respondError(c, choice.error)
      const result = await editing.setImage({ itemId, choice: choice.value })
      return result.ok
        ? c.json(toItemMetadataDto(result.value), 200)
        : respondError(c, result.error)
    })
    .post('/libraries/:id/refresh-metadata', (c) => {
      const result = editing.requestLibraryRefresh({ libraryId: c.req.param('id') })
      return result.ok
        ? c.json({ jobId: result.value.id } satisfies JobRef, 202)
        : respondError(c, result.error)
    })

export type AdminItemsRoutes = ReturnType<typeof adminItemsRoutes>
