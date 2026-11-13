// Strings of the bundled first-launch page, in the system language (English unless French).

export type Locale = 'en' | 'fr'

const en = {
  title: 'Your projo server',
  label: 'Server address',
  connect: 'Connect',
  window: { minimize: 'Minimize', maximize: 'Maximize', close: 'Close' },
  errors: {
    'server/invalid_url': 'Enter an address like http://192.168.1.10:8080.',
    'server/unreachable': 'No answer from this address.',
    'server/not_projo': 'This address does not answer like a projo server.',
    'desktop/config_not_saved': 'The address could not be saved.',
    unknown: 'Something went wrong.',
  },
}

export type Messages = typeof en

const fr: Messages = {
  title: 'Votre serveur projo',
  label: 'Adresse du serveur',
  connect: 'Se connecter',
  window: { minimize: 'Réduire', maximize: 'Agrandir', close: 'Fermer' },
  errors: {
    'server/invalid_url': 'Saisissez une adresse comme http://192.168.1.10:8080.',
    'server/unreachable': 'Aucune réponse à cette adresse.',
    'server/not_projo': 'Cette adresse ne répond pas comme un serveur projo.',
    'desktop/config_not_saved': "L'adresse n'a pas pu être enregistrée.",
    unknown: 'Une erreur est survenue.',
  },
}

export const pickLocale = (languages: readonly string[]): Locale =>
  languages[0]?.toLowerCase().startsWith('fr') === true ? 'fr' : 'en'

export const messagesFor = (locale: Locale): Messages => (locale === 'fr' ? fr : en)

/** The message of a command error (`{ code, message }`), by code. */
export const errorMessage = (messages: Messages, error: unknown): string => {
  const code = error instanceof Object && 'code' in error ? String(error.code) : 'unknown'
  return code in messages.errors
    ? messages.errors[code as keyof Messages['errors']]
    : messages.errors.unknown
}
