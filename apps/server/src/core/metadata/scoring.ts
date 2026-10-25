import { normalizeTitle } from '../naming/index.ts'
import type { TmdbSearchHit } from './tmdb.ts'

/**
 * §9.2 step 3–4: scoring of TMDB search candidates. Pure.
 *
 * match = 100 × similarity(normalized title, max over `title`, `original_title` and the
 * alternative titles when the matcher fetched them) + year term;
 * score = match + popularity tie-break (ranking).
 * Accepted when the best match reaches the threshold (stricter without a year in the name) and
 * its score leads the second one by `MARGIN`, or, among candidates closer than that, when one
 * has the best match and far more TMDB votes than each other one; otherwise the source goes to
 * "To review". The exact title one year off wins over the exact title and year with far more
 * votes.
 */

export const YEAR_EXACT_BONUS = 20
/** A file dated one year off (festival vs release, December releases): small malus only. */
export const YEAR_NEAR_MALUS = -5
export const YEAR_OTHER_MALUS = -40
/** The name has a year, the candidate has none (unreleased, incomplete entry). */
export const YEAR_UNKNOWN_MALUS = -10
export const POPULARITY_WEIGHT = 6
export const POPULARITY_CAP = 15
export const THRESHOLD_WITH_YEAR = 75
export const THRESHOLD_WITHOUT_YEAR = 85
export const MARGIN = 8
/** Homonyms (`What If...?` 4 755 votes, `WHAT / IF` 187): the vote ratio that settles them. */
export const VOTE_DOMINANCE = 10
/** Below this many votes, a ratio means nothing (10 votes against 0). */
export const MIN_DOMINANT_VOTES = 50

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
    }
    previous = current
  }
  return previous[b.length] ?? Math.max(a.length, b.length)
}

const sortedTokens = (value: string): string => value.split(' ').sort().join(' ')

/** 0..1 on normalized titles: edit-distance ratio, word order ignored. */
export const titleSimilarity = (a: string, b: string): number => {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (x === '' || y === '') return 0
  if (x === y) return 1
  const ratio = (p: string, q: string) => 1 - levenshtein(p, q) / Math.max(p.length, q.length)
  return Math.max(ratio(x, y), ratio(sortedTokens(x), sortedTokens(y)))
}

export const yearTerm = (wanted: number | undefined, candidate: number | undefined): number => {
  if (wanted === undefined) return 0
  if (candidate === undefined) return YEAR_UNKNOWN_MALUS
  const gap = Math.abs(wanted - candidate)
  if (gap === 0) return YEAR_EXACT_BONUS
  if (gap === 1) return YEAR_NEAR_MALUS
  return YEAR_OTHER_MALUS
}

export const popularityTerm = (popularity: number): number =>
  Math.min(POPULARITY_CAP, POPULARITY_WEIGHT * Math.log10(1 + Math.max(0, popularity)))

/** Best similarity over every title TMDB gave for the candidate. */
const bestTitleSimilarity = (title: string, hit: TmdbSearchHit): number => {
  const titles = [hit.title, hit.originalTitle ?? '', ...(hit.alternativeTitles ?? [])]
  return Math.max(...titles.map((candidate) => titleSimilarity(title, candidate)))
}

/** Title and year only: what the threshold is checked against. */
export const matchScore = (query: { title: string; year?: number }, hit: TmdbSearchHit): number =>
  100 * bestTitleSimilarity(query.title, hit) + yearTerm(query.year, hit.year)

/** Ranking score: the match score plus the popularity tie-break. */
export const scoreCandidate = (
  query: { title: string; year?: number },
  hit: TmdbSearchHit,
): number => matchScore(query, hit) + popularityTerm(hit.popularity)

export type ScoredHit = { hit: TmdbSearchHit; score: number; match: number }

export type PickOutcome =
  | { kind: 'accepted'; hit: TmdbSearchHit; score: number }
  | { kind: 'no_match' }
  | { kind: 'ambiguous_match'; candidates: ScoredHit[] }

export const thresholdFor = (year: number | undefined): number =>
  year === undefined ? THRESHOLD_WITHOUT_YEAR : THRESHOLD_WITH_YEAR

/** Best score first. Duplicate ids (several queries) count once, the last one kept. */
export const rankCandidates = (
  query: { title: string; year?: number },
  hits: readonly TmdbSearchHit[],
): ScoredHit[] =>
  [...new Map(hits.map((hit) => [hit.tmdbId, hit])).values()]
    .map((hit) => ({ hit, score: scoreCandidate(query, hit), match: matchScore(query, hit) }))
    .sort((a, b) => b.score - a.score)

/** Among candidates too close to call: the one with the best match and far more votes. */
const dominant = (contenders: readonly ScoredHit[]): ScoredHit | undefined => {
  const [top, next] = [...contenders].sort((a, b) => b.hit.voteCount - a.hit.voteCount)
  if (top === undefined || next === undefined) return undefined
  const bestMatch = Math.max(...contenders.map((c) => c.match))
  return top.match >= bestMatch &&
    top.hit.voteCount >= MIN_DOMINANT_VOTES &&
    top.hit.voteCount >= VOTE_DOMINANCE * next.hit.voteCount
    ? top
    : undefined
}

/**
 * A file dated one year off (festival vs release) often names the well-known film: `Split (2016)`
 * is 2017 on TMDB, 18 767 votes against three obscure 2016 `Split`. The exact title one year off
 * wins over the exact title and year when it has far more votes than each of them.
 */
const nearYearFavorite = (
  query: { title: string; year?: number },
  scored: readonly ScoredHit[],
): ScoredHit | undefined => {
  const { year } = query
  if (year === undefined) return undefined
  const exactTitle = scored.filter((c) => bestTitleSimilarity(query.title, c.hit) === 1)
  const sameYear = exactTitle.filter((c) => c.hit.year === year)
  const near = exactTitle.filter(
    (c) => c.hit.year !== undefined && Math.abs(c.hit.year - year) === 1,
  )
  if (sameYear.length === 0) return undefined
  return near.find(
    (c) =>
      c.hit.voteCount >= MIN_DOMINANT_VOTES &&
      [...sameYear, ...near].every(
        (other) => other === c || c.hit.voteCount >= VOTE_DOMINANCE * other.hit.voteCount,
      ),
  )
}

/** §9.2 step 4. */
export const pickBest = (
  query: { title: string; year?: number },
  hits: readonly TmdbSearchHit[],
): PickOutcome => {
  const scored = rankCandidates(query, hits)
  const [best, second] = scored
  // Popularity only breaks ties: it never lifts a weak title over the threshold.
  if (best === undefined || best.match < thresholdFor(query.year)) return { kind: 'no_match' }
  const favorite = nearYearFavorite(query, scored)
  if (favorite !== undefined) return { kind: 'accepted', hit: favorite.hit, score: favorite.score }
  if (second !== undefined && best.score - second.score < MARGIN) {
    const winner = dominant(scored.filter((c) => best.score - c.score < MARGIN))
    if (winner !== undefined) return { kind: 'accepted', hit: winner.hit, score: winner.score }
    return { kind: 'ambiguous_match', candidates: scored.slice(0, 5) }
  }
  return { kind: 'accepted', hit: best.hit, score: best.score }
}
