export const searchRules = { minLength: 2, maxResults: 30 } as const

export const foldLigatures = (text: string): string =>
  text
    .replaceAll('Œ', 'OE')
    .replaceAll('œ', 'oe')
    .replaceAll('Æ', 'AE')
    .replaceAll('æ', 'ae')
    .replaceAll('ẞ', 'SS')
    .replaceAll('ß', 'ss')

export const toSearchExpression = (query: string): string | undefined => {
  const words = foldLigatures(query.normalize('NFC'))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
  if (words.length === 0 || query.trim().length < searchRules.minLength) return undefined
  return words.map((word) => `"${word}"*`).join(' ')
}
