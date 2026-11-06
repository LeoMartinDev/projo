import type { Locale } from './pages.ts'

// Which language a visitor should see: the one they picked with the language switch, else the
// first of their browser's languages that the site has, else English.
export const preferredLocale = ({
  chosen,
  languages,
}: {
  chosen: string | undefined
  languages: readonly string[]
}): Locale => {
  if (chosen === 'en' || chosen === 'fr') return chosen
  for (const language of languages) {
    const code = language.toLowerCase().split('-')[0]
    if (code === 'fr' || code === 'en') return code
  }
  return 'en'
}
