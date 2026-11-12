import type { Account, AccountRepository } from '../../src/core/auth/account.ts'
import type {
  AssistantToken,
  AssistantTokenRepository,
} from '../../src/core/auth/assistant-token.ts'
import type {
  OAuthClient,
  OAuthCode,
  OAuthRepository,
  OAuthToken,
} from '../../src/core/auth/oauth.ts'
import type { Pairing, PairingCodes, PairingRepository } from '../../src/core/auth/pairing.ts'
import type { PasswordHasher, RateLimiter, SessionTokens } from '../../src/core/auth/ports.ts'
import type { Session, SessionRepository } from '../../src/core/auth/session.ts'
import type { Profile, ProfileRepository } from '../../src/core/profile/profile.ts'
import { newProfile } from '../../src/core/profile/profile.ts'
import type { SetupRepository } from '../../src/core/setup/setup.ts'

export const createFakePasswordHasher = () => {
  const calls = { hash: 0, verify: 0 }
  const hasher: PasswordHasher = {
    hash: async (plain) => {
      calls.hash += 1
      return `hashed:${plain}`
    },
    verify: async (plain, hash) => {
      calls.verify += 1
      return hash === `hashed:${plain}`
    },
  }
  return { hasher, calls }
}

export const createFakeSessionTokens = (): SessionTokens => {
  let counter = 0
  return {
    generate: () => {
      counter += 1
      return `token-${counter}`
    },
    hash: (token) => `h(${token})`,
  }
}

export const createCountingRateLimiter = (limit = 10) => {
  const hits = new Map<string, number>()
  const limiter: RateLimiter = {
    blockedFor: (key) => ((hits.get(key) ?? 0) >= limit ? 60_000 : undefined),
    hit: (key) => {
      hits.set(key, (hits.get(key) ?? 0) + 1)
    },
    reset: (key) => {
      hits.delete(key)
    },
  }
  return { limiter, hits }
}

export const sampleAccount = (overrides: Partial<Account> = {}): Account => ({
  id: 'account-1',
  username: 'Leo',
  passwordHash: 'hashed:correct horse battery',
  role: 'admin',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
})

export const sampleProfile = (overrides: Partial<Profile> = {}): Profile => ({
  ...newProfile({
    id: 'profile-1',
    accountId: 'account-1',
    name: 'Léo',
    avatarColor: 'blue',
    uiLocale: 'fr',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }),
  ...overrides,
})

export const createInMemoryAccounts = (initial: Account[] = [], profiles: Profile[] = []) => {
  const accounts = [...initial]
  const findByUsername = (username: string) =>
    accounts.find((account) => account.username.toLowerCase() === username.toLowerCase())
  const update = (id: string, patch: (account: Account) => Account) => {
    const index = accounts.findIndex((account) => account.id === id)
    const account = accounts[index]
    if (account !== undefined) accounts[index] = patch(account)
  }
  const repository: AccountRepository = {
    findById: (id) => accounts.find((account) => account.id === id),
    findByUsername,
    list: () => [...accounts],
    countEnabledAdmins: () =>
      accounts.filter((account) => account.role === 'admin' && account.disabledAt === undefined)
        .length,
    create: ({ account, profile }) => {
      if (findByUsername(account.username) !== undefined) return 'username_taken'
      accounts.push(account)
      profiles.push(profile)
      return 'created'
    },
    setRole: ({ id, role }) => update(id, (account) => ({ ...account, role })),
    setDisabled: ({ id, disabledAt }) =>
      update(id, ({ disabledAt: _previous, ...account }) =>
        disabledAt === undefined ? account : { ...account, disabledAt },
      ),
    setPasswordHash: ({ id, passwordHash }) =>
      update(id, (account) => ({ ...account, passwordHash })),
    delete: (id) => {
      const index = accounts.findIndex((account) => account.id === id)
      if (index >= 0) accounts.splice(index, 1)
      for (let i = profiles.length - 1; i >= 0; i -= 1) {
        if (profiles[i]?.accountId === id) profiles.splice(i, 1)
      }
    },
  }
  return { repository, accounts }
}

export const createInMemoryProfiles = (
  initial: Profile[] = [],
  { libraryIds = [] }: { libraryIds?: readonly string[] } = {},
) => {
  const profiles = [...initial]
  const repository: ProfileRepository = {
    findById: (id) => profiles.find((profile) => profile.id === id),
    listByAccount: (accountId) => profiles.filter((profile) => profile.accountId === accountId),
    create: (profile, { maxPerAccount }) => {
      if (profiles.filter((p) => p.accountId === profile.accountId).length >= maxPerAccount)
        return false
      profiles.push(profile)
      return true
    },
    update: (profile) => {
      const index = profiles.findIndex((existing) => existing.id === profile.id)
      if (index >= 0) profiles[index] = profile
    },
    delete: (id) => {
      const index = profiles.findIndex((profile) => profile.id === id)
      if (index >= 0) profiles.splice(index, 1)
    },
    unknownLibraryIds: (ids) => [...new Set(ids)].filter((id) => !libraryIds.includes(id)),
  }
  return { repository, profiles }
}

export const createInMemorySessions = (initial: Session[] = []) => {
  const sessions = new Map(initial.map((session) => [session.id, session]))
  const update = (id: string, patch: Partial<Session>) => {
    const session = sessions.get(id)
    if (session !== undefined) sessions.set(id, { ...session, ...patch })
  }
  const repository: SessionRepository = {
    create: (session) => {
      sessions.set(session.id, session)
      return session
    },
    findById: (id) => sessions.get(id),
    findByTokenHash: (tokenHash) =>
      [...sessions.values()].find((session) => session.tokenHash === tokenHash),
    touch: ({ id, lastSeenAt, expiresAt }) => update(id, { lastSeenAt, expiresAt }),
    setLastProfile: ({ id, profileId }) => update(id, { lastProfileId: profileId }),
    revoke: ({ id, revokedAt }) => {
      if (sessions.get(id)?.revokedAt === undefined) update(id, { revokedAt })
    },
    listActiveByAccount: ({ accountId, now }) =>
      [...sessions.values()]
        .filter(
          (session) =>
            session.accountId === accountId &&
            session.revokedAt === undefined &&
            session.expiresAt.getTime() > now.getTime(),
        )
        .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()),
    revokeAllByAccount: ({ accountId, revokedAt, exceptId }) => {
      for (const session of sessions.values()) {
        if (
          session.accountId === accountId &&
          session.id !== exceptId &&
          session.revokedAt === undefined
        ) {
          update(session.id, { revokedAt })
        }
      }
    },
  }
  return { repository, sessions }
}

export const createFakePairingCodes = (codes: string[] = []): PairingCodes => {
  const queue = [...codes]
  let counter = 0
  return {
    generate: () => {
      counter += 1
      return queue.shift() ?? `ZZZZZ${(counter % 8) + 2}`
    },
    hash: (code) => `h(${code})`,
  }
}

export const createInMemoryPairings = (initial: Pairing[] = []) => {
  const pairings = [...initial]
  const repository: PairingRepository = {
    create: (pairing) => {
      pairings.push(pairing)
    },
    findByCodeHash: (codeHash) =>
      pairings
        .filter((pairing) => pairing.codeHash === codeHash)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
    listLiveByAccount: ({ accountId, now }) =>
      pairings.filter(
        (pairing) =>
          pairing.accountId === accountId &&
          pairing.claimedAt === undefined &&
          pairing.expiresAt.getTime() > now.getTime(),
      ),
    claim: ({ id, claimedAt, claimedSessionId }) => {
      const index = pairings.findIndex((pairing) => pairing.id === id)
      const pairing = pairings[index]
      if (pairing === undefined || pairing.claimedAt !== undefined) return false
      pairings[index] = { ...pairing, claimedAt, claimedSessionId }
      return true
    },
    deleteExpiredBefore: (before) => {
      for (let i = pairings.length - 1; i >= 0; i -= 1) {
        if ((pairings[i]?.expiresAt.getTime() ?? 0) < before.getTime()) pairings.splice(i, 1)
      }
    },
  }
  return { repository, pairings }
}

export const createInMemorySetup = () => {
  const state = {
    accounts: [] as Account[],
    profiles: [] as Profile[],
    settings: new Map<string, unknown>(),
  }
  const repository: SetupRepository = {
    isCompleted: () => state.accounts.length > 0,
    complete: ({ account, profile, settings }) => {
      if (state.accounts.length > 0) return 'already_completed'
      state.accounts.push(account)
      state.profiles.push(profile)
      for (const [key, value] of Object.entries(settings)) state.settings.set(key, value)
      return 'completed'
    },
  }
  return { repository, state }
}

export const createInMemoryAssistantTokens = (initial: AssistantToken[] = []) => {
  const tokens = new Map(initial.map((token) => [token.id, token]))
  const repository: AssistantTokenRepository = {
    create: (token) => {
      tokens.set(token.id, token)
      return token
    },
    findById: (id) => tokens.get(id),
    findByTokenHash: (tokenHash) =>
      [...tokens.values()].find((token) => token.tokenHash === tokenHash),
    listActiveByAccount: (accountId) =>
      [...tokens.values()].filter(
        (token) => token.accountId === accountId && token.revokedAt === undefined,
      ),
    revoke: ({ id, accountId, revokedAt }) => {
      const token = tokens.get(id)
      if (token === undefined || token.revokedAt !== undefined) return false
      if (accountId !== undefined && token.accountId !== accountId) return false
      tokens.set(id, { ...token, revokedAt })
      return true
    },
    touch: ({ id, lastUsedAt }) => {
      const token = tokens.get(id)
      if (token !== undefined) tokens.set(id, { ...token, lastUsedAt })
    },
  }
  return { repository, tokens }
}

/** In-memory OAuthRepository; codes are consumed once and refresh tokens rotated once. */
export const createInMemoryOAuth = (initialClients: OAuthClient[] = []) => {
  const clients = new Map(initialClients.map((client) => [client.id, client]))
  const codes = new Map<string, OAuthCode>()
  const tokens = new Map<string, OAuthToken>()
  const touched: { id: string; at: Date }[] = []
  const purged: { now: Date; unusedBefore: Date }[] = []
  const repository: OAuthRepository = {
    findClient: (clientId) => [...clients.values()].find((client) => client.clientId === clientId),
    findClientById: (id) => clients.get(id),
    saveClient: (client) => {
      clients.set(client.id, client)
      return client
    },
    touchClient: ({ id, at }) => {
      touched.push({ id, at })
      const client = clients.get(id)
      if (client !== undefined) clients.set(id, { ...client, lastUsedAt: at })
    },
    createCode: (code) => {
      codes.set(code.codeHash, code)
    },
    consumeCode: ({ codeHash, usedAt }) => {
      const code = codes.get(codeHash)
      if (code === undefined || code.usedAt !== undefined) return undefined
      codes.set(codeHash, { ...code, usedAt })
      return code
    },
    createToken: (token) => {
      tokens.set(token.tokenHash, token)
    },
    findToken: (tokenHash) => tokens.get(tokenHash),
    markRotated: ({ tokenHash, at }) => {
      const token = tokens.get(tokenHash)
      if (token === undefined || token.rotatedAt !== undefined) return false
      tokens.set(tokenHash, { ...token, rotatedAt: at })
      return true
    },
    purge: (input) => {
      purged.push(input)
    },
  }
  return { repository, clients, codes, tokens, touched, purged }
}
