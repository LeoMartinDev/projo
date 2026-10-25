import { type APIRequestContext, expect, type Page } from '@playwright/test'

import { fr } from './i18n.ts'

export type Credentials = { username: string; password: string }

/** Created by the first-launch wizard (parcours 1), which runs before every other journey. */
export const admin: Credentials = { username: 'admin', password: 'e2e-admin-password' }

/** `POST /auth/login` on an API context: its cookie jar (and its pages, if any) is signed in. */
export const apiSignIn = async (api: APIRequestContext, who: Credentials): Promise<void> => {
  const response = await api.post('/api/v1/auth/login', { data: who })
  expect(response.ok(), `login of ${who.username}: ${response.status()}`).toBe(true)
}

/**
 * A household member created by the admin (`POST /admin/accounts`), with a single profile: no
 * "Who's watching?" at sign-in. `api` is signed in as the admin.
 */
export const createMember = async (
  api: APIRequestContext,
  member: Credentials & { profileName: string },
): Promise<void> => {
  const response = await api.post('/api/v1/admin/accounts', {
    data: {
      username: member.username,
      password: member.password,
      profile: { name: member.profileName },
    },
  })
  expect(response.status(), `account ${member.username}: ${await response.text()}`).toBe(201)
}

/** Sign-in through the login page. */
export const signIn = async (page: Page, who: Credentials): Promise<void> => {
  await page.goto('/login')
  await page.getByLabel(fr.login.username).fill(who.username)
  await page.getByLabel(fr.login.password, { exact: true }).fill(who.password)
  await page.getByRole('button', { name: fr.login.submit }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
