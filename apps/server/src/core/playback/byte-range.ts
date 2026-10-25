/** HTTP `Range` (RFC 9110 §14) for the direct stream: one range of bytes, inclusive bounds. */

export type ByteRange = { start: number; end: number }

export type RangeRequest =
  { kind: 'full' } | { kind: 'partial'; range: ByteRange } | { kind: 'unsatisfiable' }

/**
 * `bytes=0-499`, `bytes=500-`, `bytes=-500`. Several ranges: only the first is served (players
 * never ask for more). An unparsable header or another unit is ignored (full response), as the
 * RFC allows; a syntactically valid range outside the file is unsatisfiable (416).
 */
export const parseRange = (header: string | undefined, size: number): RangeRequest => {
  if (header === undefined) return { kind: 'full' }
  const match = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*(?:,.*)?$/i.exec(header.trim()) ?? undefined
  if (match === undefined) return { kind: 'full' }
  const [, first = '', last = ''] = match
  if (first === '' && last === '') return { kind: 'full' }

  if (first === '') {
    const suffix = Number(last)
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', range: { start: Math.max(0, size - suffix), end: size - 1 } }
  }
  const start = Number(first)
  // `last < first` is an invalid range-spec: ignored like any unparsable header.
  if (last !== '' && Number(last) < start) return { kind: 'full' }
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
  return { kind: 'partial', range: { start, end } }
}
