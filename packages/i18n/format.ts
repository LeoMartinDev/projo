const pad = (value: number) => String(value).padStart(2, '0')

export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

const intlUnits =
  new Intl.NumberFormat('en', { style: 'unit', unit: 'hour', unitDisplay: 'short' }).format(1) ===
  '1 hr'

const shortUnits = { hour: { fr: 'h', en: 'hr' }, minute: { fr: 'min', en: 'min' } } as const

const unit = (locale: string, name: 'hour' | 'minute', value: number, intl: boolean) =>
  intl
    ? new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'short' }).format(
        value,
      )
    : `${value}\u00a0${shortUnits[name][locale.startsWith('en') ? 'en' : 'fr']}`

export const formatDuration = (ms: number, locale: string, intl = intlUnits): string => {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return unit(locale, 'minute', minutes, intl)
  if (minutes === 0) return unit(locale, 'hour', hours, intl)
  return `${unit(locale, 'hour', hours, intl)} ${unit(locale, 'minute', minutes, intl)}`
}

export const formatBytes = (bytes: number, locale: string): string => {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const
  let value = Math.max(0, bytes)
  let index = 0
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000
    index += 1
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[index] ?? 'byte',
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 && index > 0 ? 1 : 0,
  }).format(value)
}

export const formatNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale).format(value)

export const formatPercent = (ratio: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio)

export const formatDate = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))

export const formatDateTime = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

export const formatSoon = (iso: string, locale: string, now: Date = new Date()): string => {
  const date = new Date(iso)
  return date.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date)
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date)
}

const relativeSteps: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.345],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

export const formatRelative = (iso: string, locale: string, now: Date = new Date()): string => {
  if (typeof Intl.RelativeTimeFormat !== 'function') return new Date(iso).toLocaleDateString(locale)
  let value = Math.min(0, (new Date(iso).getTime() - now.getTime()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  for (const [name, size] of relativeSteps) {
    if (Math.abs(value) < size) return formatter.format(Math.round(value), name)
    value /= size
  }
  return formatter.format(Math.round(value), 'year')
}
