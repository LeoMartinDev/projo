import { desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import type {
  Invitation,
  InvitationListing,
  InvitationRepository,
} from '../../core/invitation/invitation.ts'
import { invitationState } from '../../core/invitation/invitation.ts'
import { toAccountRow, usernameTaken } from './account-repository.ts'
import type { Db } from './database.ts'
import { insertProfile } from './profile-repository.ts'
import { fromIso, fromIsoNullable, toIso, toNullable } from './rows.ts'
import { accounts, invitations } from './schema/accounts.ts'

type InvitationRow = typeof invitations.$inferSelect

const toInvitation = (row: InvitationRow): Invitation => {
  const usedAt = fromIsoNullable(row.usedAt)
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    ...(row.createdBy === null ? {} : { createdBy: row.createdBy }),
    expiresAt: fromIso(row.expiresAt),
    ...(usedAt === undefined ? {} : { usedAt }),
    ...(row.usedByAccountId === null ? {} : { usedByAccountId: row.usedByAccountId }),
  }
}

const creators = alias(accounts, 'creators')
const users = alias(accounts, 'users')

export const createSqliteInvitationRepository = ({ db }: { db: Db }): InvitationRepository => {
  const listing = () =>
    db
      .select({
        invitation: invitations,
        createdByUsername: creators.username,
        usedByUsername: users.username,
      })
      .from(invitations)
      .leftJoin(creators, eq(creators.id, invitations.createdBy))
      .leftJoin(users, eq(users.id, invitations.usedByAccountId))

  const toListing = (row: {
    invitation: InvitationRow
    createdByUsername: string | null
    usedByUsername: string | null
  }): InvitationListing => ({
    ...toInvitation(row.invitation),
    ...(row.createdByUsername === null ? {} : { createdByUsername: row.createdByUsername }),
    ...(row.usedByUsername === null ? {} : { usedByUsername: row.usedByUsername }),
  })

  return {
    create: (invitation) => {
      db.insert(invitations)
        .values({
          id: invitation.id,
          tokenHash: invitation.tokenHash,
          createdBy: toNullable(invitation.createdBy),
          expiresAt: toIso(invitation.expiresAt),
          usedAt: toNullable(invitation.usedAt && toIso(invitation.usedAt)),
          usedByAccountId: toNullable(invitation.usedByAccountId),
        })
        .run()
    },
    findByTokenHash: (tokenHash) => {
      const row = db.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).get()
      return row && toInvitation(row)
    },
    findById: (id) => {
      const row = listing().where(eq(invitations.id, id)).get()
      return row && toListing(row)
    },
    list: () =>
      listing().orderBy(desc(invitations.expiresAt), desc(invitations.id)).all().map(toListing),
    delete: (id) => {
      db.delete(invitations).where(eq(invitations.id, id)).run()
    },
    accept: ({ tokenHash, account, profile, at }) =>
      db.transaction((tx) => {
        const row = tx.select().from(invitations).where(eq(invitations.tokenHash, tokenHash)).get()
        if (row === undefined) return 'not_found'
        const state = invitationState(toInvitation(row), at)
        if (state !== 'pending') return state
        if (usernameTaken(tx, account.username)) return 'username_taken'
        tx.insert(accounts).values(toAccountRow(account)).run()
        insertProfile(tx, profile)
        tx.update(invitations)
          .set({ usedAt: toIso(at), usedByAccountId: account.id })
          .where(eq(invitations.id, row.id))
          .run()
        return 'accepted'
      }),
  }
}
