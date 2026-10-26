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

export { canAdminister, canManageAccount, pickActiveProfile } from '@projo/shared/api/auth'
