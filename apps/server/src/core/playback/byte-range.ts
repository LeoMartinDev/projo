export type ByteRange = { start: number; end: number }

export type RangeRequest =
  { kind: 'full' } | { kind: 'partial'; range: ByteRange } | { kind: 'unsatisfiable' }

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
  if (last !== '' && Number(last) < start) return { kind: 'full' }
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1)
  return { kind: 'partial', range: { start, end } }
}
