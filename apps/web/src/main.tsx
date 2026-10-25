// Global styles first: feature stylesheets imported by the routes must come after them.
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
import { signedOut } from './shared/session/session.ts'
import { trackScrollbarWidth } from './shared/styles/scrollbar.ts'

setupI18n()
trackScrollbarWidth()

const queryClient = createAppQueryClient(() => {
  if (router.state.location.pathname === '/login') return
  signedOut(queryClient)
  void router.navigate({
    to: '/login',
    search: { redirect: router.state.location.href },
    replace: true,
  })
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
