export type Credentials = { readonly token?: string; readonly profileId?: string }

let current: Credentials = {}

export const getCredentials = (): Credentials => current

export const setCredentials = (credentials: Credentials): void => {
  current = credentials
}
