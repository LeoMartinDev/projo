import type { SourceListItem, SourceRepository } from '../../core/source/source.ts'
import { type LibraryNames, type NamedSource, nameSources } from './library-names.ts'

type Deps = {
  sources: Pick<SourceRepository, 'page'>
  libraries: LibraryNames
}

export type HiddenSourcesPage = {
  total: number
  items: NamedSource<SourceListItem>[]
  nextCursor?: string
}

export const listHiddenSourcesFactory =
  ({ sources, libraries }: Deps) =>
  ({ cursor, limit }: { cursor?: string; limit: number }): HiddenSourcesPage => {
    const page = sources.page({
      state: 'rejected',
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    })
    return {
      total: page.total,
      items: nameSources(libraries, page.items),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
  }

export type ListHiddenSources = ReturnType<typeof listHiddenSourcesFactory>
