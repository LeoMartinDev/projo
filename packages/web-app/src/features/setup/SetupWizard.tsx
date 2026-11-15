import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { pickActiveProfile } from '../../shared/session/active-profile.ts'
import { signedIn } from '../../shared/session/session.ts'
import { AccountStep } from './AccountStep.tsx'
import { type CreatedLibrary, LibraryStep } from './LibraryStep.tsx'
import { ReadyScreen } from './ReadyScreen.tsx'
import { WelcomeScreen } from './WelcomeScreen.tsx'

type Screen =
  | { kind: 'welcome' }
  | { kind: 'account' }
  | { kind: 'library'; name: string }
  | { kind: 'ready'; name: string; library?: CreatedLibrary }

export const SetupWizard = () => {
  const queryClient = useQueryClient()
  const [screen, setScreen] = useState<Screen>({ kind: 'welcome' })

  switch (screen.kind) {
    case 'welcome':
      return <WelcomeScreen onStart={() => setScreen({ kind: 'account' })} />
    case 'account':
      return (
        <AccountStep
          onBack={() => setScreen({ kind: 'welcome' })}
          onDone={(me) => {
            signedIn(queryClient, me)
            setScreen({
              kind: 'library',
              name: pickActiveProfile(me)?.name ?? me.account.username,
            })
          }}
        />
      )
    case 'library':
      return (
        <LibraryStep
          onDone={(library) =>
            setScreen({
              kind: 'ready',
              name: screen.name,
              ...(library === undefined ? {} : { library }),
            })
          }
        />
      )
    case 'ready':
      return (
        <ReadyScreen
          name={screen.name}
          {...(screen.library === undefined ? {} : { library: screen.library })}
        />
      )
  }
}
