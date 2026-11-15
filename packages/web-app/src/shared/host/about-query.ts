import { queryOptions } from '@tanstack/react-query'

import type { AppHost } from '../../host.ts'

/** The host's rows of Account → About (the desktop app's version), read once per page. */
export const hostAboutQuery = (aboutRows: AppHost['aboutRows']) =>
  queryOptions({
    queryKey: ['host-about'],
    queryFn: () => aboutRows?.() ?? Promise.resolve([]),
    enabled: aboutRows !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
