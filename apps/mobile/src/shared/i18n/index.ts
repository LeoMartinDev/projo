import { getLocales } from 'expo-localization'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './en.json'
import fr from './fr.json'
import { detectLocale, type Locale } from './locale.ts'

export const resources = {
  fr: { translation: fr },
  en: { translation: en },
} as const

/** Device language by default; the active profile's `ui_locale` will override it (§19). */
export const setupI18n = (
  locale: Locale = detectLocale(getLocales().map(({ languageTag }) => languageTag)),
) => {
  void i18next.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  })
  return i18next
}
