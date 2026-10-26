export const locales = ['fr', 'en'] as const
export type Locale = (typeof locales)[number]

const isLocale = (value: string): value is Locale => locales.some((locale) => locale === value)

/** First supported language of the device, in its order of preference; French otherwise (§19). */
export const detectLocale = (languageTags: readonly string[]): Locale => {
  for (const tag of languageTags) {
    const base = tag.toLowerCase().split('-')[0] ?? ''
    if (isLocale(base)) return base
  }
  return 'fr'
}
