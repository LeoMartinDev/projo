export const isAnime = ({
  genres,
  originalLanguage,
}: {
  genres?: readonly string[]
  originalLanguage?: string
}): boolean =>
  (genres ?? []).includes('animation') &&
  originalLanguage?.trim().toLowerCase().split(/[-_]/u)[0] === 'ja'
