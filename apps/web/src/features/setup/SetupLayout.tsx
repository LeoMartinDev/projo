import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Backdrop, type BackdropImage } from '../../shared/backdrops/Backdrop.tsx'
import { Logo } from '../shell/Logo.tsx'
import './setup.css'

export const setupSteps = ['account', 'library'] as const
export type SetupStep = (typeof setupSteps)[number]

const barState = (position: number, current: number) =>
  position < current ? 'done' : position === current ? 'current' : 'todo'

/**
 * A wizard step (artboards `OnbAccount`, `OnbLibrary`): illustration, the wordmark and the step
 * bars on top, the display title on the left and the step's glass panel on the right.
 */
export const StepScreen = ({
  step,
  image,
  title,
  children,
}: {
  step: SetupStep
  image: BackdropImage
  title: string
  children: ReactNode
}) => {
  const { t } = useTranslation()
  const index = setupSteps.indexOf(step)
  return (
    <div className="onb">
      <Backdrop image={image} shade="split" />
      <header className="onb__header">
        <Logo />
        <div className="onb__progress">
          <div className="steps" aria-hidden="true">
            {setupSteps.map((name, position) => (
              <span key={name} className="steps__bar" data-state={barState(position, index)} />
            ))}
          </div>
          <span className="onb__step">
            {t('setup.stepOf', {
              step: index + 1,
              total: setupSteps.length,
              name: t(`setup.steps.${step}`),
            })}
          </span>
        </div>
      </header>
      <main className="onb__main onb__main--split">
        <h1 className="onb__display rise r1">{title}</h1>
        {children}
      </main>
    </div>
  )
}
