let activeProfileId: string | undefined

export const getActiveProfileId = (): string | undefined => activeProfileId

export const setActiveProfileId = (id: string | undefined): void => {
  activeProfileId = id
}

export { canAdminister, canManageAccount, pickActiveProfile } from '@projo/shared/api/auth'
