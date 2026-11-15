import '@projo/design/fonts.css'
import '@projo/design/tokens.css'
import '@projo/design/base.css'
import './shared/styles/app.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { createAppQueryClient } from './app/query-client.ts'
import { createAppRouter } from './app/router.tsx'
import { installPlaybackPriming } from './features/player/engines/html-video/player-element.ts'
import { type AppHost, HostProvider } from './host.ts'
import { isPlayerPath } from './features/player/player-path.ts'
import { eventHub, onEventsUnauthorized } from './shared/events/events.ts'
import { bindHost } from './shared/host/bound-host.ts'
import { trackInstallPrompt } from './shared/app-install/install-prompt.ts'
import { setupI18n } from './shared/i18n/index.ts'
import { setActiveProfileId } from './shared/session/active-profile.ts'
import { sessionQuery, signedOut } from './shared/session/session.ts'
import { trackScrollbarWidth } from './shared/styles/scrollbar.ts'

export const mountApp = (container: HTMLElement, host: AppHost): void => {
  bindHost(host)
  setupI18n()
  trackScrollbarWidth()
  trackInstallPrompt()
  installPlaybackPriming()

  // A request (or the event stream) answered 401: the session is over.
  const sessionLost = () => {
    if (router.state.location.pathname === '/login') return
    signedOut(queryClient)
    void router.navigate({
      to: '/login',
      search: { redirect: router.state.location.href },
      replace: true,
    })
  }
  const queryClient = createAppQueryClient({
    onSessionLost: sessionLost,
    onProfileLost: () => {
      if (router.state.location.pathname === '/profiles') return
      const redirect = router.state.location.href
      setActiveProfileId(undefined)
      void queryClient
        .invalidateQueries({ queryKey: sessionQuery.queryKey, refetchType: 'all' })
        .then(() => router.navigate({ to: '/profiles', search: { redirect }, replace: true }))
    },
  })
  const router = createAppRouter(queryClient)
  onEventsUnauthorized(sessionLost)
  host.updates.start({
    onReconnect: eventHub.onReconnect,
    isPlaying: () => isPlayerPath(window.location.pathname),
  })

  createRoot(container).render(
    <StrictMode>
      <HostProvider host={host}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </HostProvider>
    </StrictMode>,
  )
}
