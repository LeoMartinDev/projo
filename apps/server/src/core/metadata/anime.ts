/**
 * §11.1 (and the home "Anime" row, §13.3): an anime is a work of genre `animation` whose
 * original language is Japanese. A Japanese live-action film is not one, nor a French animated
 * film. For an episode or a season, the work is its series (they copy its genres).
 */
export const isAnime = ({
  genres,
  originalLanguage,
}: {
  genres?: readonly string[]
  originalLanguage?: string
}): boolean =>
  (genres ?? []).includes('animation') &&
  originalLanguage?.trim().toLowerCase().split(/[-_]/u)[0] === 'ja'
