import type { SegmentProviderIdDto } from '@projo/shared/api/segments'

/**
 * Segment providers of the "Intros and credits" settings (§12.2, §15): `providers` is the ordered list of
 * the enabled ones, a provider absent from it is disabled. The table shows the enabled ones in
 * their order, then the disabled ones. Pure: tests run in Bun.
 */

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

/** Turned on: asked last; turned off: out of the list. */
export const setProviderEnabled = (
  enabled: readonly SegmentProviderIdDto[],
  id: SegmentProviderIdDto,
  on: boolean,
): SegmentProviderIdDto[] => {
  const without = enabled.filter((candidate) => candidate !== id)
  return on ? [...without, id] : without
}

/** One step earlier (`-1`) or later (`1`) among the enabled ones; unchanged at an end. */
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
