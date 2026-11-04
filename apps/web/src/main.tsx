import './shared/styles/fonts.css'
import './shared/styles/tokens.css'
import './shared/styles/base.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { createAppQueryClient } from './app/query-client.ts'
import { createAppRouter } from './app/router.tsx'
import { setupI18n } from './shared/i18n/index.ts'
import { setActiveProfileId } from './shared/session/active-profile.ts'
import { sessionQuery, signedOut } from './shared/session/session.ts'
import { trackScrollbarWidth } from './shared/styles/scrollbar.ts'

setupI18n()
trackScrollbarWidth()

window.addEventListener('vite:preloadError', (event) => {
  const key = `projo:preload-reload:${event.payload.message}`
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  window.location.reload()
})

const queryClient = createAppQueryClient({
  onSessionLost: () => {
    if (router.state.location.pathname === '/login') return
    signedOut(queryClient)
    void router.navigate({
      to: '/login',
      search: { redirect: router.state.location.href },
      replace: true,
    })
  },
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

const container = document.getElementById('root')
if (!container) throw new Error('#root element missing from index.html')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
