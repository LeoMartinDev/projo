/** TMDB metadata languages offered in the forms (BCP 47, `metadataLanguageSchema`). */
export const metadataLanguages = [
  'fr-FR',
  'fr-CA',
  'en-US',
  'en-GB',
  'es-ES',
  'de-DE',
  'it-IT',
  'pt-BR',
  'nl-NL',
  'ja-JP',
] as const

/** Content-rating countries (ISO 3166-1 alpha-2). */
export const ratingCountries = ['FR', 'BE', 'CH', 'CA', 'US', 'GB', 'DE', 'ES', 'IT'] as const

/** `fr-FR` → `French (France)`, in the interface language. */
export const languageLabel = (code: string, locale: string): string => {
  const label = new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
}

export const countryLabel = (code: string, locale: string): string =>
  new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code
