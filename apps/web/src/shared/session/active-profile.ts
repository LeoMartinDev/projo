import type { MeResponse, ProfileDto } from '@projo/shared/api/auth'

/**
 * The profile the API calls act for (`X-Profile-Id`, §17.1): the one `GET /auth/me` resolved
 * (`activeProfileId`: the header, the only profile, or the last one this session used, §13.6).
 * None while "Who's watching?" has to be answered (`needsProfileSelection`): the server would
 * refuse a profile this session has not chosen (or unlocked with its PIN).
 */
let activeProfileId: string | undefined

export const getActiveProfileId = (): string | undefined => activeProfileId

export const setActiveProfileId = (id: string | undefined): void => {
  activeProfileId = id
}

export const pickActiveProfile = (me: MeResponse): ProfileDto | undefined =>
  me.activeProfileId === undefined
    ? undefined
    : me.profiles.find((profile) => profile.id === me.activeProfileId)

/**
 * §14: the administration is open to an admin account acting from an unrestricted profile (every
 * library, no maximum rating), never from a child's profile on that account.
 */
export const canAdminister = (me: MeResponse): boolean => {
  if (me.account.role !== 'admin') return false
  const profile = pickActiveProfile(me)
  return profile !== undefined && !isRestricted(profile)
}

const isRestricted = (profile: Pick<ProfileDto, 'libraryAccess' | 'maxContentRating'>): boolean =>
  profile.libraryAccess !== 'all' || profile.maxContentRating !== undefined

/**
 * §14: account actions (devices, tokens, password, creating or changing other profiles, PINs) are
 * refused to a restricted profile; without an active profile, as soon as one profile of the
 * account is restricted (the server acts as the most restricted one).
 */
export const canManageAccount = (me: MeResponse): boolean => {
  const profile = pickActiveProfile(me)
  return profile === undefined ? !me.profiles.some(isRestricted) : !isRestricted(profile)
}
