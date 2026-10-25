/**
 * §13.5 search: instant, local, on title and original title of movies and series, accent and
 * case insensitive (FTS5 `unicode61 remove_diacritics 2`), from 2 characters, 30 results max.
 */
export const searchRules = { minLength: 2, maxResults: 30 } as const

/**
 * The FTS5 MATCH expression of what the user typed: every word as a prefix (`"amel"*`), all
 * required. Words are split like the tokenizer does (anything not a letter or a digit), so no
 * user input can reach FTS5 syntax. `undefined` when nothing searchable is left.
 */
export const toSearchExpression = (query: string): string | undefined => {
  const words = query
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
  if (words.length === 0 || query.trim().length < searchRules.minLength) return undefined
  return words.map((word) => `"${word}"*`).join(' ')
}
