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

export const matchLocale = (languages: readonly string[]): Locale => {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0] ?? ''
    if (isLocale(base)) return base
  }
  return 'fr'
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof fr }
  }
}
