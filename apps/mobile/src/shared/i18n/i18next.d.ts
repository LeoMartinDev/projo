import 'i18next'

import type fr from './fr.json'

// Typed keys: `t('connect.title')` is checked against fr.json (the reference locale).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof fr }
  }
}
