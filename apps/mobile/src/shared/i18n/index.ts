import { getLocales } from 'expo-localization'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { type Locale, matchLocale, resources } from '@projo/i18n'

/** Device language by default (§19); the active profile's `ui_locale` overrides it. */
export const setupI18n = (
  locale: Locale = matchLocale(getLocales().map(({ languageTag }) => languageTag)),
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

export const changeLocale = async (locale: Locale): Promise<void> => {
  if ((i18next.resolvedLanguage ?? i18next.language) !== locale)
    await i18next.changeLanguage(locale)
}
