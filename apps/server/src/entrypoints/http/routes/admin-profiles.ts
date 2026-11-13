import { Hono } from 'hono'

import {
  createAccountProfileBodySchema,
  type LibraryProfileAccessResponse,
  setLibraryProfilesBodySchema,
} from '@projo/shared/api/accounts'

import type { CreateAccountProfile } from '../../../application/profile/create-account-profile.ts'
import type { ListLibraryAccess } from '../../../application/profile/list-library-access.ts'
import type { SetLibraryAccess } from '../../../application/profile/set-library-access.ts'
import type { LibraryProfileAccess } from '../../../application/profile/shared/library-profile-access.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'
import { toProfileDto } from './auth.ts'

const toAccessResponse = (items: LibraryProfileAccess[]): LibraryProfileAccessResponse => ({
  items: items.map(({ profile, username, hasAccess }) => ({
    profileId: profile.id,
    name: profile.name,
    avatarColor: profile.avatarColor,
    accountId: profile.accountId,
    username,
    libraryAccess: profile.libraryAccess,
    hasAccess,
  })),
})

export const adminProfilesRoutes = ({
  createAccountProfile,
  listLibraryAccess,
  setLibraryAccess,
}: {
  createAccountProfile: CreateAccountProfile
  listLibraryAccess: ListLibraryAccess
  setLibraryAccess: SetLibraryAccess
}) =>
  new Hono<AppEnv>()
    .post('/accounts/:id/profiles', validate('json', createAccountProfileBodySchema), async (c) => {
      const result = await createAccountProfile({
        accountId: c.req.param('id'),
        input: c.req.valid('json'),
      })
      return result.ok ? c.json(toProfileDto(result.value), 201) : respondError(c, result.error)
    })
    .get('/libraries/:id/profiles', (c) => {
      const result = listLibraryAccess({ libraryId: c.req.param('id') })
      return result.ok ? c.json(toAccessResponse(result.value), 200) : respondError(c, result.error)
    })
    .put('/libraries/:id/profiles', validate('json', setLibraryProfilesBodySchema), (c) => {
      const result = setLibraryAccess({
        libraryId: c.req.param('id'),
        profileIds: c.req.valid('json').profileIds,
      })
      return result.ok ? c.json(toAccessResponse(result.value), 200) : respondError(c, result.error)
    })

export type AdminProfilesRoutes = ReturnType<typeof adminProfilesRoutes>
