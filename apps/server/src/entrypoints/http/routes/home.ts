import { Hono } from 'hono'

import {
  type ContinueWatchingEntryDto,
  type HomeCategoriesDto,
  homeCategoriesQuerySchema,
  homeCategoryOfSlug,
  type HomeCategoryPage,
  homeCategoryPageQuerySchema,
  homeCategoryParamSchema,
  type HomeDto,
  type HomeRowDto,
  type ResumeFrameDto,
} from '@projo/shared/api/home'

import type { GetHome } from '../../../application/home/get-home.ts'
import type { GetHomeCategories } from '../../../application/home/get-home-categories.ts'
import type { GetHomeCategoryPage } from '../../../application/home/get-home-category-page.ts'
import type { ResumeFrame } from '../../../application/playback/resume-frames.ts'
import type { VisibilityScopeResolver } from '../../../core/catalog/catalog.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'
import { toItemSummaryDto, toPlayTargetDto } from './catalog.ts'

const toResumeFrameDto = ({ sourceId, second }: ResumeFrame): ResumeFrameDto => ({
  url: `/api/v1/trickplay/${encodeURIComponent(sourceId)}/frames/${second}.webp`,
})

/** §13.3 hero video preview (`preview_clip`): the clip URL when ready; missing clips requested. */
export type HomePreviewPort = {
  previewUrl: (input: { itemId: string; profileId: string }) => string | undefined
  prepare: (input: { itemIds: readonly string[]; profileId: string }) => void
}

/** §13.3: the timeline thumbnail at a resume position, when the file has sprites. */
export type HomeResumeFramePort = (input: {
  itemId: string
  positionMs: number
  profileId: string
}) => ResumeFrame | undefined

type Deps = {
  getHome: GetHome
  getHomeCategories: GetHomeCategories
  getHomeCategoryPage: GetHomeCategoryPage
  scopeFor: VisibilityScopeResolver
  previews?: HomePreviewPort
  resumeFrames?: HomeResumeFramePort
}

/**
 * §13.3 `GET /home`: the hero and the fixed rows in one request; `GET /home/categories`: the
 * category rows under them, batch by batch; `GET /home/categories/:category`: the page of a
 * category behind its row's "See all ›". Mounted at `/api/v1`.
 */
export const homeRoutes = ({
  getHome,
  getHomeCategories,
  getHomeCategoryPage,
  scopeFor,
  previews,
  resumeFrames,
}: Deps) =>
  new Hono<AppEnv>()
    .get('/home', async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const home = await getHome({ profileId: profileId.value, scope: scopeFor(profileId.value) })
      // §13.3/§18: a clip is cut for what enters "Continue watching" / "Up next" without one.
      previews?.prepare({
        itemIds: [
          ...home.continueWatching.map((entry) => entry.item.id),
          ...home.upNext.map(({ entry }) => entry.item.id),
        ],
        profileId: profileId.value,
      })
      const rows: HomeRowDto[] = [
        {
          kind: 'continue_watching',
          items: home.continueWatching.map((entry): ContinueWatchingEntryDto => {
            const progress =
              entry.progress?.kind === 'playable' ? entry.progress.progress : undefined
            const frame =
              progress === undefined
                ? undefined
                : resumeFrames?.({
                    itemId: entry.item.id,
                    positionMs: progress.positionMs,
                    profileId: profileId.value,
                  })
            return {
              ...toItemSummaryDto(entry),
              ...(frame === undefined ? {} : { resumeFrame: toResumeFrameDto(frame) }),
            }
          }),
        },
        {
          kind: 'up_next',
          items: home.upNext.map(({ entry, isNew }) => ({
            episode: toItemSummaryDto(entry),
            isNew,
          })),
        },
        { kind: 'recently_added', items: home.recentlyAdded.map(toItemSummaryDto) },
        { kind: 'watchlist', items: home.watchlist.map(toItemSummaryDto) },
      ]
      const { hero } = home
      const previewUrl =
        hero === undefined
          ? undefined
          : previews?.previewUrl({ itemId: hero.item.item.id, profileId: profileId.value })
      return c.json(
        {
          ...(hero === undefined
            ? {}
            : {
                hero: {
                  item: {
                    ...toItemSummaryDto(hero.item),
                    ...(hero.item.item.overview === undefined
                      ? {}
                      : { overview: hero.item.item.overview }),
                    genres: hero.item.item.genres,
                  },
                  ...(hero.episode === undefined
                    ? {}
                    : { episode: toItemSummaryDto(hero.episode) }),
                  ...(hero.play === undefined ? {} : { play: toPlayTargetDto(hero.play) }),
                  ...(previewUrl === undefined ? {} : { previewUrl }),
                },
              }),
          // §13.3: an empty row is left out.
          rows: rows.filter((row) => row.items.length > 0),
        } satisfies HomeDto,
        200,
      )
    })
    .get('/home/categories', validate('query', homeCategoriesQuerySchema), async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const { cursor } = c.req.valid('query')
      const view = await getHomeCategories({
        profileId: profileId.value,
        scope: scopeFor(profileId.value),
        offset: cursor === undefined ? 0 : Number(cursor),
      })
      return c.json(
        {
          rows: view.rows.map(({ category, entries }) => ({
            category,
            items: entries.map(toItemSummaryDto),
          })),
          total: view.total,
          ...(view.nextOffset === undefined ? {} : { nextCursor: String(view.nextOffset) }),
        } satisfies HomeCategoriesDto,
        200,
      )
    })
    .get(
      '/home/categories/:category',
      validate('param', homeCategoryParamSchema),
      validate('query', homeCategoryPageQuerySchema),
      async (c) => {
        const profileId = currentProfileId(c)
        if (!profileId.ok) return respondError(c, profileId.error)
        const { cursor, limit } = c.req.valid('query')
        const page = await getHomeCategoryPage({
          profileId: profileId.value,
          scope: scopeFor(profileId.value),
          category: homeCategoryOfSlug(c.req.valid('param').category),
          offset: cursor === undefined ? 0 : Number(cursor),
          limit,
        })
        return c.json(
          {
            items: page.entries.map(toItemSummaryDto),
            ...(page.nextOffset === undefined ? {} : { nextCursor: String(page.nextOffset) }),
          } satisfies HomeCategoryPage,
          200,
        )
      },
    )

export type HomeRoutes = ReturnType<typeof homeRoutes>
