import { createInstance, type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'

import { matchLocale, resources } from '@projo/i18n'

/**
 * The strings of the screens before the app (`@projo/i18n`, the system's language). Its own
 * instance: the app sets up the shared one when it mounts (`mountApp`).
 */
export const entryI18n = (languages: readonly string[] = navigator.languages): I18n => {
  const i18n = createInstance()
  void i18n.use(initReactI18next).init({
    resources,
    lng: matchLocale(languages),
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    initAsync: false,
  })
  return i18n
}
