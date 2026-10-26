/**
 * Localised labels the web takes from `Intl` (§19). Hermes lacks `Intl.DisplayNames` and may lack
 * `Intl.RelativeTimeFormat`: then a plainer label, never a crash.
 */

/** Each language in itself, as iOS lists them, where `Intl.DisplayNames` is missing. */
const endonyms: Record<string, string> = {
  ar: 'العربية',
  cs: 'Čeština',
  da: 'Dansk',
  de: 'Deutsch',
  el: 'Ελληνικά',
  en: 'English',
  es: 'Español',
  fi: 'Suomi',
  fr: 'Français',
  he: 'עברית',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  nl: 'Nederlands',
  no: 'Norsk',
  pl: 'Polski',
  pt: 'Português',
  ru: 'Русский',
  sv: 'Svenska',
  th: 'ไทย',
  tr: 'Türkçe',
  uk: 'Українська',
  vi: 'Tiếng Việt',
  zh: '中文',
}

/**
 * ISO 639-2 codes of the languages above (ffprobe's track tags, §13.5 available tracks), the
 * bibliographic forms (`fre`, `ger`) included.
 */
const twoLetterOf: Record<string, string> = {
  ara: 'ar',
  ces: 'cs',
  cze: 'cs',
  dan: 'da',
  deu: 'de',
  ger: 'de',
  ell: 'el',
  gre: 'el',
  eng: 'en',
  spa: 'es',
  fin: 'fi',
  fra: 'fr',
  fre: 'fr',
  heb: 'he',
  hin: 'hi',
  ind: 'id',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  nld: 'nl',
  dut: 'nl',
  nor: 'no',
  pol: 'pl',
  por: 'pt',
  rus: 'ru',
  swe: 'sv',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  vie: 'vi',
  zho: 'zh',
  chi: 'zh',
}

/**
 * "Français", "Japanese": a language by its ISO 639-1 (or 639-2) code, in `locale` when `Intl`
 * can.
 */
export const languageName = (tag: string, locale: string): string => {
  const code = twoLetterOf[tag.toLowerCase()] ?? tag
  const name =
    typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(code)
      : undefined
  if (name === undefined) return endonyms[code] ?? code.toUpperCase()
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

const relativeSteps = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
] as const

/** "5 min ago", "yesterday" (the web's `formatRelative`); a date where Hermes cannot. */
export const formatRelative = (iso: string, locale: string, now: Date = new Date()): string => {
  const date = new Date(iso)
  if (typeof Intl.RelativeTimeFormat !== 'function') return date.toLocaleDateString(locale)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  let value = Math.min(0, (date.getTime() - now.getTime()) / 1000)
  for (const [unit, size] of relativeSteps) {
    if (Math.abs(value) < size) return formatter.format(Math.round(value), unit)
    value /= size
  }
  return formatter.format(Math.round(value), 'year')
}
