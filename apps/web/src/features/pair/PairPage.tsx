import { useTranslation } from 'react-i18next'

import { Backdrop } from '../../shared/backdrops/Backdrop.tsx'
import { Logo } from '../shell/Logo.tsx'
import '../setup/setup.css'
import './pair.css'

/**
 * `/pair?code=…` (§14): where a pairing QR code leads when scanned by something other than the
 * projo app. Public; it only says to open the app and scan the code.
 */
export const PairPage = () => {
  const { t } = useTranslation()
  return (
    <div className="onb">
      <Backdrop image="forest" shade="split" />
      <header className="onb__header">
        <span className="rise">
          <Logo />
        </span>
      </header>
      <main className="onb__main onb__main--center">
        <h1 className="onb__hero onb__hero--center rise r1">{t('pair.title')}</h1>
        <p className="pair__text rise r2">{t('pair.body')}</p>
      </main>
    </div>
  )
}
