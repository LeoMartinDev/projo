import type { SegmentProviderIdDto } from '@projo/shared/api/segments'

export const allSegmentProviders = [
  'theintrodb',
  'introdb',
  'skipdb',
] as const satisfies readonly SegmentProviderIdDto[]

export type ProviderRow = { id: SegmentProviderIdDto; enabled: boolean }

export const providerRows = (enabled: readonly SegmentProviderIdDto[]): ProviderRow[] => [
  ...enabled.map((id) => ({ id, enabled: true })),
  ...allSegmentProviders
    .filter((id) => !enabled.includes(id))
    .map((id) => ({ id, enabled: false })),
]

export const setProviderEnabled = (
  enabled: readonly SegmentProviderIdDto[],
  id: SegmentProviderIdDto,
  on: boolean,
): SegmentProviderIdDto[] => {
  const without = enabled.filter((candidate) => candidate !== id)
  return on ? [...without, id] : without
}

export const moveProvider = (
  enabled: readonly SegmentProviderIdDto[],
  id: SegmentProviderIdDto,
  step: -1 | 1,
): SegmentProviderIdDto[] => {
  const from = enabled.indexOf(id)
  const to = from + step
  if (from === -1 || to < 0 || to >= enabled.length) return [...enabled]
  const next = [...enabled]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
