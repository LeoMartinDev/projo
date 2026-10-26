import en from './en.json'
import fr from './fr.json'

export const locales = ['fr', 'en'] as const
export type Locale = (typeof locales)[number]

export const resources = {
  fr: { translation: fr },
  en: { translation: en },
} as const

export const isLocale = (value: string): value is Locale =>
  locales.some((locale) => locale === value)

/** The first supported language of a preference list (`['en-GB', 'fr']` → `en`), else `fr` (§19). */
export const matchLocale = (languages: readonly string[]): Locale => {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0] ?? ''
    if (isLocale(base)) return base
  }
  return 'fr'
}

// Typed keys: `t('home.title')` is checked against fr.json (the reference locale), in every
// program that imports this package.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof fr }
  }
}
