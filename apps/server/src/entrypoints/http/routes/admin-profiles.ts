import { Hono } from 'hono'

import {
  createAccountProfileBodySchema,
  type LibraryProfileAccessResponse,
  setLibraryProfilesBodySchema,
} from '@projo/shared/api/accounts'

import type {
  LibraryAccess,
  LibraryProfileAccess,
} from '../../../application/profile/library-access.ts'
import type { Profiles } from '../../../application/profile/profiles.ts'
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

/**
 * Profiles administered from elsewhere (§15): `POST /accounts/:id/profiles` (Comptes) and
 * `GET/PUT /libraries/:id/profiles` ("Profiles with access" of a library, §14). Built by the
 * profiles module, mounted at `/api/v1/admin` (behind `requireAdmin`). Never `.use('*')`.
 */
export const adminProfilesRoutes = ({
  profiles,
  libraryAccess,
}: {
  profiles: Profiles
  libraryAccess: LibraryAccess
}) =>
  new Hono<AppEnv>()
    .post('/accounts/:id/profiles', validate('json', createAccountProfileBodySchema), async (c) => {
      const result = await profiles.createForAccount({
        accountId: c.req.param('id'),
        input: c.req.valid('json'),
      })
      return result.ok ? c.json(toProfileDto(result.value), 201) : respondError(c, result.error)
    })
    .get('/libraries/:id/profiles', (c) => {
      const result = libraryAccess.list({ libraryId: c.req.param('id') })
      return result.ok ? c.json(toAccessResponse(result.value), 200) : respondError(c, result.error)
    })
    .put('/libraries/:id/profiles', validate('json', setLibraryProfilesBodySchema), (c) => {
      const result = libraryAccess.set({
        libraryId: c.req.param('id'),
        profileIds: c.req.valid('json').profileIds,
      })
      return result.ok ? c.json(toAccessResponse(result.value), 200) : respondError(c, result.error)
    })

export type AdminProfilesRoutes = ReturnType<typeof adminProfilesRoutes>
