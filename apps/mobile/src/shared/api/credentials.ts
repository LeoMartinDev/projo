/**
 * What the API calls are made with (§17.1): the device's bearer token (§26.3) and the active
 * profile (`X-Profile-Id`). Read at request time by the client; set by the session.
 */
export type Credentials = { readonly token?: string; readonly profileId?: string }

let current: Credentials = {}

export const getCredentials = (): Credentials => current

export const setCredentials = (credentials: Credentials): void => {
  current = credentials
}
