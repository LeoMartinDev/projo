import { type Context, Hono } from 'hono'

import {
  createProfileBodySchema,
  deleteProfileBodySchema,
  type ProfilesResponse,
  selectProfileBodySchema,
  updateProfileBodySchema,
  verifyPinBodySchema,
} from '@projo/shared/api/profiles'

import type { GetMe } from '../../../application/auth/get-me.ts'
import type { CreateProfile } from '../../../application/profile/create-profile.ts'
import type { DeleteProfile } from '../../../application/profile/delete-profile.ts'
import type { ListProfiles } from '../../../application/profile/list-profiles.ts'
import type { SelectProfile } from '../../../application/profile/select-profile.ts'
import type { ProfileActor } from '../../../application/profile/shared/profile-actor.ts'
import type { UpdateProfile } from '../../../application/profile/update-profile.ts'
import type { VerifyProfilePin } from '../../../application/profile/verify-profile-pin.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal } from '../principal.ts'
import { noContent } from '../responses.ts'
import { validate } from '../validation.ts'
import { respondErrorWithRetry, toMeResponse, toProfileDto } from './auth.ts'

type Deps = {
  listProfiles: ListProfiles
  createProfile: CreateProfile
  updateProfile: UpdateProfile
  deleteProfile: DeleteProfile
  verifyProfilePin: VerifyProfilePin
  selectProfile: SelectProfile
  getMe: GetMe
}

const actorOf = (c: Context<AppEnv>): ProfileActor => {
  const { account, session } = currentPrincipal(c)
  const activeProfileId = c.get('profileId')
  return {
    accountId: account.id,
    role: account.role,
    sessionId: session.id,
    ...(activeProfileId === undefined ? {} : { activeProfileId }),
  }
}

export const profilesRoutes = ({
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  verifyProfilePin,
  selectProfile,
  getMe,
}: Deps) =>
  new Hono<AppEnv>()
    .get('/profiles', (c) => {
      const { account } = currentPrincipal(c)
      return c.json(
        {
          items: listProfiles({ accountId: account.id }).map(toProfileDto),
        } satisfies ProfilesResponse,
        200,
      )
    })
    .post('/profiles', validate('json', createProfileBodySchema), async (c) => {
      const result = await createProfile({ actor: actorOf(c), input: c.req.valid('json') })
      return result.ok ? c.json(toProfileDto(result.value), 201) : respondError(c, result.error)
    })
    .patch('/profiles/:id', validate('json', updateProfileBodySchema), async (c) => {
      const result = await updateProfile({
        actor: actorOf(c),
        profileId: c.req.param('id'),
        input: c.req.valid('json'),
      })
      return result.ok
        ? c.json(toProfileDto(result.value), 200)
        : respondErrorWithRetry(c, result.error)
    })
    .delete('/profiles/:id', validate('json', deleteProfileBodySchema), async (c) => {
      const { currentPin } = c.req.valid('json')
      const result = await deleteProfile({
        actor: actorOf(c),
        profileId: c.req.param('id'),
        ...(currentPin === undefined ? {} : { currentPin }),
      })
      return result.ok ? noContent(c) : respondErrorWithRetry(c, result.error)
    })
    .post('/profiles/:id/verify-pin', validate('json', verifyPinBodySchema), async (c) => {
      const result = await verifyProfilePin({
        actor: actorOf(c),
        profileId: c.req.param('id'),
        pin: c.req.valid('json').pin,
      })
      return result.ok ? noContent(c) : respondErrorWithRetry(c, result.error)
    })
    .post('/profiles/:id/select', validate('json', selectProfileBodySchema), async (c) => {
      const actor = actorOf(c)
      const { pin } = c.req.valid('json')
      const result = await selectProfile({
        actor,
        profileId: c.req.param('id'),
        ...(pin === undefined ? {} : { pin }),
      })
      if (!result.ok) return respondErrorWithRetry(c, result.error)
      const me = getMe({ accountId: actor.accountId, activeProfileId: result.value.id })
      return me.ok ? c.json(toMeResponse(me.value), 200) : respondError(c, me.error)
    })

export type ProfilesRoutes = ReturnType<typeof profilesRoutes>
