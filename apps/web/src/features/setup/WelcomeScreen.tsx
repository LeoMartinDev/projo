import { useTranslation } from 'react-i18next'

import { Backdrop } from '../../shared/backdrops/Backdrop.tsx'
import { ArrowRightIcon } from '../../shared/ui/icons.tsx'
import { Logo } from '../shell/Logo.tsx'
import './setup.css'

/** Artboard `OnbWelcome`: the first screen of a fresh server. */
export const WelcomeScreen = ({ onStart }: { onStart: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className="onb">
      <Backdrop image="dunes" shade="hero" />
      <header className="onb__header">
        <span className="rise">
          <Logo />
        </span>
      </header>
      <main className="onb__main onb__main--hero">
        <h1 className="onb__hero rise r2">{t('setup.welcome.title')}</h1>
        <div className="rise r4">
          <button type="button" className="button button--primary button--large" onClick={onStart}>
            {t('setup.welcome.start')}
            <span className="button__arrow" aria-hidden="true">
              <ArrowRightIcon />
            </span>
          </button>
        </div>
      </main>
    </div>
  )
}
