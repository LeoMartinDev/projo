import { type APIRequestContext, expect, type Page } from '@playwright/test'

import { fr } from './i18n.ts'

export type Credentials = { username: string; password: string }

export const admin: Credentials = { username: 'admin', password: 'e2e-admin-password' }

export const apiSignIn = async (api: APIRequestContext, who: Credentials): Promise<void> => {
  const response = await api.post('/api/v1/auth/login', { data: who })
  expect(response.ok(), `login of ${who.username}: ${response.status()}`).toBe(true)
}

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

export const signIn = async (page: Page, who: Credentials): Promise<void> => {
  await page.goto('/login')
  await page.getByLabel(fr.login.username).fill(who.username)
  await page.getByLabel(fr.login.password, { exact: true }).fill(who.password)
  await page.getByRole('button', { name: fr.login.submit }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
