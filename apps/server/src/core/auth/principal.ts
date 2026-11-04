import type { AccountRole, SessionKind } from '@projo/shared/api/auth'

export type AuthAccount = {
  id: string
  username: string
  role: AccountRole
}

export type AuthSession = {
  id: string
  accountId: string
  kind: SessionKind
}
