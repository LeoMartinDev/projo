import { currentLocale } from '../../shared/i18n/index.ts'

const formats = new Map<string, Intl.DateTimeFormat>()

const formatOf = (key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
  const locale = currentLocale()
  const cacheKey = `${key}|${locale}`
  let format = formats.get(cacheKey)
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, options)
    formats.set(cacheKey, format)
  }
  return format
}

/** A programme's time of day in the interface's language (`20:45`, `8:45 PM`). */
export const clockTime = (iso: string): string =>
  formatOf('clock', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/**
 * A programme's start and end (§29.6): `20:45 – 21:40`, with its day (`mer. 19 nov.`) when it
 * does not start on the day of `at`.
 */
export const programmeTimes = (startAt: string, endAt: string, at: number): string => {
  const start = new Date(startAt)
  const times = `${clockTime(startAt)} – ${clockTime(endAt)}`
  return sameDay(start, new Date(at))
    ? times
    : `${formatOf('day', { weekday: 'short', day: 'numeric', month: 'short' }).format(start)} · ${times}`
}
