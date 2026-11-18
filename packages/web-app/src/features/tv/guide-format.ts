import { currentLocale } from '../../shared/i18n/index.ts'

const formats = new Map<string, Intl.DateTimeFormat>()

/** A programme's time of day in the interface's language (`20:45`, `8:45 PM`). */
export const clockTime = (iso: string): string => {
  const locale = currentLocale()
  let format = formats.get(locale)
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
    formats.set(locale, format)
  }
  return format.format(new Date(iso))
}
