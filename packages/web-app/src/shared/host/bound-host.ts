import type { AppHost } from '../../host.ts'

// The host of this page, for the module-level pieces that live outside React (the API client,
// the event hub, media URLs). `mountApp` binds it before anything renders; components read it
// through `useHost()`.
let bound: AppHost | undefined

export const bindHost = (host: AppHost): void => {
  bound = host
}

export const boundHost = (): AppHost => {
  if (bound === undefined) throw new Error('the app host is bound by mountApp()')
  return bound
}
