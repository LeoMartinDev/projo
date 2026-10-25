import type { AccountRole, SessionKind } from '@projo/shared/api/auth'

/** The authenticated account of a request, as exposed to routes and use cases. */
export type AuthAccount = {
  id: string
  username: string
  role: AccountRole
}

/** The auth session (cookie or bearer) the request was authenticated with. */
export type AuthSession = {
  id: string
  accountId: string
  kind: SessionKind
}
