import { queryOptions, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import type { LibraryProfileAccessDto } from '@projo/shared/api/accounts'

import { api, request } from '../../shared/api/client.ts'
import { Switch } from '../../shared/ui/controls.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { Avatar } from '../shell/Avatar.tsx'
import { accountsQuery } from './accounts/queries.ts'
import { librariesQueryKey } from './queries.ts'

/** `GET /admin/libraries/:id/profiles`: who sees this library (§14 "Profiles with access"). */
export const libraryProfilesQuery = (libraryId: string) =>
  queryOptions({
    queryKey: [...librariesQueryKey, libraryId, 'profiles'],
    queryFn: () =>
      request(() => api.admin.libraries[':id'].profiles.$get({ param: { id: libraryId } })),
  })

export type ProfileRow = Omit<LibraryProfileAccessDto, 'hasAccess'>

/**
 * The profiles of every account and who sees the library: from the library once it exists, else
 * from the accounts (a new library is seen by the profiles that see every library).
 */
export const useLibraryProfiles = (
  libraryId: string | undefined,
): {
  rows: ProfileRow[] | undefined
  initial: ReadonlySet<string> | undefined
  error: unknown
} => {
  const existing = useQuery({
    ...libraryProfilesQuery(libraryId ?? ''),
    enabled: libraryId !== undefined,
  })
  const accounts = useQuery({ ...accountsQuery, enabled: libraryId === undefined })
  if (libraryId !== undefined) {
    const items = existing.data?.items
    return {
      rows: items,
      initial:
        items === undefined
          ? undefined
          : new Set(items.filter((row) => row.hasAccess).map((row) => row.profileId)),
      error: existing.error,
    }
  }
  const rows = accounts.data?.items.flatMap((account) =>
    account.profiles.map((profile): ProfileRow => ({
      profileId: profile.id,
      name: profile.name,
      avatarColor: profile.avatarColor,
      accountId: account.id,
      username: account.username,
      libraryAccess: profile.libraryAccess,
    })),
  )
  return {
    rows,
    initial:
      rows === undefined
        ? undefined
        : new Set(rows.filter((row) => row.libraryAccess === 'all').map((row) => row.profileId)),
    error: accounts.error,
  }
}

/**
 * "Profiles with access" of the library form (§14, §15, artboard `AdminAddLibrary`): one switch per
 * profile of every account. Saved with the library (`PUT /admin/libraries/:id/profiles`).
 */
export const LibraryProfiles = ({
  formId,
  rows,
  error,
  selected,
  onChange,
}: {
  formId: string
  rows: ProfileRow[] | undefined
  error: unknown
  selected: ReadonlySet<string>
  onChange: (next: ReadonlySet<string>) => void
}) => {
  const { t } = useTranslation()
  return (
    <fieldset className="library-form__section">
      <legend className="library-form__legend">{t('admin.form.profiles')}</legend>
      {error ? <ErrorAlert error={error} /> : undefined}
      <ul className="profile-access well" aria-busy={rows === undefined}>
        {rows === undefined
          ? [0, 1].map((index) => (
              <li key={index} className="profile-access__row" aria-hidden="true">
                <span className="skeleton skeleton--line profile-access__skeleton" />
              </li>
            ))
          : rows.map((row) => {
              const labelId = `${formId}-profile-${row.profileId}`
              return (
                <li key={row.profileId} className="profile-access__row">
                  <Avatar name={row.name} color={row.avatarColor} />
                  <span id={labelId} className="profile-access__name">
                    {row.name}
                    <span className="profile-access__account">{row.username}</span>
                  </span>
                  <Switch
                    checked={selected.has(row.profileId)}
                    labelId={labelId}
                    onChange={(value) => {
                      const next = new Set(selected)
                      if (value) next.add(row.profileId)
                      else next.delete(row.profileId)
                      onChange(next)
                    }}
                  />
                </li>
              )
            })}
      </ul>
    </fieldset>
  )
}
