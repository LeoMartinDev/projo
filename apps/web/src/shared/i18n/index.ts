import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './en.json'
import fr from './fr.json'

export const locales = ['fr', 'en'] as const
export type Locale = (typeof locales)[number]

export const resources = {
  fr: { translation: fr },
  en: { translation: en },
} as const

const isLocale = (value: string): value is Locale => locales.some((locale) => locale === value)

/** Browser language by default (§19); the active profile's `ui_locale` overrides it. */
export const detectLocale = (languages: readonly string[] = navigator.languages): Locale => {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0] ?? ''
    if (isLocale(base)) return base
  }
  return 'fr'
}

export const setupI18n = (locale: Locale = detectLocale()) => {
  void i18next.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  })
  document.documentElement.lang = locale
  return i18next
}

export const currentLocale = (): Locale => {
  const language = i18next.resolvedLanguage ?? i18next.language
  return isLocale(language) ? language : 'fr'
}

export const changeLocale = async (locale: Locale): Promise<void> => {
  if (currentLocale() !== locale) await i18next.changeLanguage(locale)
  document.documentElement.lang = locale
}
