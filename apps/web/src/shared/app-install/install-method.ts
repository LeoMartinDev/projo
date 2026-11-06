import type { Device } from '@projo/design/media'

// 'prompt': the browser offered its own install dialog (Chromium, `beforeinstallprompt`).
// 'ios': no install API on iOS, any browser: the user adds projo from the share menu.
export type InstallMethod = 'prompt' | 'ios'

const iosDevice = /\b(?:iPhone|iPad|iPod)\b/

// iPadOS asks for desktop sites by default and reports itself as a Mac; touch tells them apart.
export const isIos = ({
  userAgent,
  maxTouchPoints,
}: {
  userAgent: string
  maxTouchPoints: number
}) => iosDevice.test(userAgent) || (userAgent.includes('Macintosh') && maxTouchPoints > 1)

export const installMethodOf = ({
  device,
  installed,
  canPrompt,
  userAgent,
  maxTouchPoints,
}: {
  device: Device
  installed: boolean
  canPrompt: boolean
  userAgent: string
  maxTouchPoints: number
}): InstallMethod | undefined => {
  if (installed || device === 'desktop') return undefined
  if (canPrompt) return 'prompt'
  return isIos({ userAgent, maxTouchPoints }) ? 'ios' : undefined
}
