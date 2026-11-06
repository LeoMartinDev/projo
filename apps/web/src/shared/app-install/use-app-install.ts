import { media } from '@projo/design/media'
import { useDevice, useMedia } from '../ui/use-media.ts'
import { installMethodOf } from './install-method.ts'
import { useCanPromptInstall } from './install-prompt.ts'

// iOS's own flag for an app opened from the home screen, alongside `display-mode`.
const launchedFromHomeScreen = () => 'standalone' in navigator && navigator.standalone === true

export const useAppInstall = () => {
  const device = useDevice()
  const standalone = useMedia(media.installed)
  const canPrompt = useCanPromptInstall()
  return installMethodOf({
    device,
    installed: standalone || launchedFromHomeScreen(),
    canPrompt,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  })
}
