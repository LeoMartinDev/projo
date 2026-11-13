import type { ParsedNameDto } from '@projo/shared/api/libraries'

import type { ParsedName } from '../../../core/naming/index.ts'

export const toParsedNameDto = (parsed: ParsedName): ParsedNameDto => {
  const { part: _part, absoluteEpisodeEnd: _end, ids, ...rest } = parsed
  return {
    ...rest,
    ...(ids === undefined || Object.keys(ids).length === 0 ? {} : { ids: { ...ids } }),
  }
}
