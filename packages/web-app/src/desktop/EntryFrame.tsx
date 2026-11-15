import type { FormEvent, ReactNode } from 'react'

import { Field } from '../shared/ui/controls.tsx'
import { Backdrop } from '../shared/backdrops/Backdrop.tsx'
import { Logo } from '../features/shell/Logo.tsx'
import '../features/auth/auth.css'

export { Field }

/**
 * The desktop host's screens before the app (§28.3: server address, unreachable, server too old,
 * setup in the browser), drawn like the sign-in page that follows them: the `ocean` backdrop, the
 * logo, one panel. A form when `onSubmit` is given.
 */
export const EntryFrame = ({
  title,
  onSubmit,
  children,
}: {
  title: string
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) => {
  const content = (
    <>
      <h1 className="auth__title">{title}</h1>
      {children}
    </>
  )
  return (
    <div className="auth">
      <Backdrop image="ocean" shade="split" />
      <header className="auth__header rise">
        <Logo />
      </header>
      <main className="auth__main">
        {onSubmit === undefined ? (
          <section className="panel auth__panel rise r2">{content}</section>
        ) : (
          <form className="panel auth__panel rise r2" onSubmit={onSubmit} noValidate>
            {content}
          </form>
        )}
      </main>
    </div>
  )
}
