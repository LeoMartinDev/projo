import { useTranslation } from 'react-i18next'

import { Dialog } from '../ui/Dialog.tsx'
import { CheckIcon } from '../ui/icons.tsx'
import { AddToHomeIcon, ShareIcon } from '../ui/media-icons.tsx'
import './install-app.css'

// iOS has no install API: the steps of the share menu, the same in every iOS browser.
export const InstallAppDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useTranslation()
  const steps = [
    { icon: <ShareIcon size={20} />, text: t('shell.install.share') },
    { icon: <AddToHomeIcon size={20} />, text: t('shell.install.addToHomeScreen') },
    { icon: <CheckIcon size={20} />, text: t('shell.install.add') },
  ]
  return (
    <Dialog open={open} title={t('shell.install.title')} onClose={onClose}>
      <ol className="install-steps">
        {steps.map((step) => (
          <li key={step.text} className="install-steps__step">
            <span className="install-steps__icon" aria-hidden="true">
              {step.icon}
            </span>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
    </Dialog>
  )
}
