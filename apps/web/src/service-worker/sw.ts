import { routeRequest, shellPath, skipWaitingMessage } from './routing.ts'

declare const __PRECACHE__: string[]
declare const __CACHE_NAME__: string

type ExtendableEvent = Event & { waitUntil: (promise: Promise<unknown>) => void }
type FetchEvent = ExtendableEvent & {
  request: Request
  respondWith: (response: Promise<Response>) => void
}
type ServiceWorkerScope = {
  location: Location
  skipWaiting: () => Promise<void>
  clients: { claim: () => Promise<void> }
  addEventListener: {
    (type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void
    (type: 'fetch', listener: (event: FetchEvent) => void): void
    (type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  }
}

const scope = self as unknown as ServiceWorkerScope
const cacheName = __CACHE_NAME__
const precached = new Set(__PRECACHE__)

scope.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) =>
        cache.addAll(__PRECACHE__.map((path) => new Request(path, { cache: 'no-cache' }))),
      ),
  )
})

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('projo-') && name !== cacheName)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => scope.clients.claim()),
  )
})

scope.addEventListener('message', (event) => {
  if (event.data === skipWaitingMessage) void scope.skipWaiting()
})

const fromCache = async (key: string, request: Request): Promise<Response> => {
  const cached = await caches.match(key, { cacheName })
  return cached ?? fetch(request)
}

scope.addEventListener('fetch', (event) => {
  const { request } = event
  const route = routeRequest({
    method: request.method,
    mode: request.mode,
    url: new URL(request.url),
    origin: scope.location.origin,
    precached,
  })
  if (route === 'shell') event.respondWith(fromCache(shellPath, request))
  else if (route === 'precached')
    event.respondWith(fromCache(new URL(request.url).pathname, request))
})
