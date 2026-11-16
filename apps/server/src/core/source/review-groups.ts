import type { ReviewReason } from '@projo/shared/api/metadata'

import { showFolderOf } from '../naming/index.ts'
import type { Source } from './source.ts'

/**
 * The series groups of "To review" (§7.8), the one rule behind the list, "It's an episode of…"
 * (the files it takes along) and hiding a group: a file to review linked to an episode under a
 * show belongs with the other files to review of that show, in the same show folder of the same
 * library root. Any other file to review (movie, `unknown`, episode without a number, which the
 * scanner never links to an episode) is a group of its own.
 */

/** A file of "To review" (`ready`, `needs_review`), as the grouping sees it. */
export type ReviewCandidate = {
  id: string
  rootId: string
  relativePath: string
  reviewReason?: ReviewReason
  /** The episode it is linked to under a show: its lowest season, then episode. */
  episode?: {
    showId: string
    showTitle?: string
    seasonNumber?: number
    episodeNumber?: number
  }
}

export type ReviewGroup = {
  /** First file first: lowest season, then episode, then path. */
  files: ReviewCandidate[]
  /** Set for a group of a series: the show it is linked to, and its folder in the root. */
  series?: { showId: string; title?: string; showFolder: string }
}

export type ReviewQueue = {
  /** Every file to review, in the list's order of files (newest id first, as `page`). */
  candidates: (query: { libraryId?: string }) => ReviewCandidate[]
}

export const awaitsReview = (source: Pick<Source, 'state' | 'matchState'>): boolean =>
  source.matchState === 'needs_review' && source.state === 'ready'

const seriesKeyOf = (candidate: ReviewCandidate): string =>
  candidate.episode === undefined
    ? `file\u0000${candidate.id}`
    : [
        'series',
        candidate.episode.showId,
        candidate.rootId,
        showFolderOf(candidate.relativePath),
      ].join('\u0000')

// SQLite's ascending order: an absent number first, text compared by code unit
const ascending = (a: number | string | undefined, b: number | string | undefined): number => {
  if (a === b) return 0
  if (a === undefined) return -1
  if (b === undefined) return 1
  return a < b ? -1 : 1
}

const firstFileFirst = (a: ReviewCandidate, b: ReviewCandidate): number =>
  ascending(a.episode?.seasonNumber, b.episode?.seasonNumber) ||
  ascending(a.episode?.episodeNumber, b.episode?.episodeNumber) ||
  ascending(a.relativePath, b.relativePath) ||
  ascending(a.id, b.id)

const groupOf = (files: ReviewCandidate[]): ReviewGroup => {
  const sorted = [...files].sort(firstFileFirst)
  const [first] = sorted
  if (first?.episode === undefined) return { files: sorted }
  const { showId, showTitle } = first.episode
  return {
    files: sorted,
    series: {
      showId,
      ...(showTitle === undefined || showTitle === '' ? {} : { title: showTitle }),
      showFolder: showFolderOf(first.relativePath),
    },
  }
}

type Placed = { position: string; group: ReviewGroup }

const placeGroups = (candidates: readonly ReviewCandidate[]): Placed[] => {
  const byKey = new Map<string, { position: string; files: ReviewCandidate[] }>()
  for (const candidate of candidates) {
    const key = seriesKeyOf(candidate)
    const placed = byKey.get(key)
    if (placed === undefined) byKey.set(key, { position: candidate.id, files: [candidate] })
    else placed.files.push(candidate)
  }
  return [...byKey.values()].map(({ position, files }) => ({ position, group: groupOf(files) }))
}

/**
 * The groups of the files to review, given in the list's order: a group takes the place of the
 * earliest of its files.
 */
export const groupForReview = (candidates: readonly ReviewCandidate[]): ReviewGroup[] =>
  placeGroups(candidates).map(({ group }) => group)

/**
 * A page of groups. The list's order is newest id first, so a group is placed by the id of its
 * earliest file, and the cursor (that id for the last group of a page) is followed as `page`'s:
 * the next page starts at the first group placed below it.
 */
export const pageReviewGroups = (
  candidates: readonly ReviewCandidate[],
  { cursor, limit }: { cursor?: string; limit: number },
): { groups: ReviewGroup[]; nextCursor?: string } => {
  const placed = placeGroups(candidates).filter(
    ({ position }) => cursor === undefined || position < cursor,
  )
  const page = placed.slice(0, limit)
  const last = page.at(-1)
  return {
    groups: page.map(({ group }) => group),
    ...(placed.length > limit && last !== undefined ? { nextCursor: last.position } : {}),
  }
}

/** The group of one file to review; undefined when the file is not among the candidates. */
export const reviewGroupOf = (
  candidates: readonly ReviewCandidate[],
  sourceId: string,
): ReviewGroup | undefined => {
  const file = candidates.find((candidate) => candidate.id === sourceId)
  if (file === undefined) return undefined
  const key = seriesKeyOf(file)
  return groupOf(candidates.filter((candidate) => seriesKeyOf(candidate) === key))
}

/** The reasons of a group's files, most frequent first. */
export const reviewReasonsOf = (group: ReviewGroup): { reason: ReviewReason; count: number }[] => {
  const counts = new Map<ReviewReason, number>()
  for (const { reviewReason } of group.files) {
    if (reviewReason !== undefined) counts.set(reviewReason, (counts.get(reviewReason) ?? 0) + 1)
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || ascending(a.reason, b.reason))
}
