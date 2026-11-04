import { skipWaitingMessage } from '../../service-worker/routing.ts'
import { createUpdater } from './update-policy.ts'

const installTimeoutMs = 30_000
const takeoverTimeoutMs = 10_000
const attemptKey = 'projo:update-attempt'

const container = (): ServiceWorkerContainer | undefined =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : undefined

const after = (ms: number): Promise<undefined> =>
  new Promise((resolve) => setTimeout(() => resolve(undefined), ms))

export const registerServiceWorker = (): void => {
  const workers = container()
  if (workers === undefined || !import.meta.env.PROD) return
  void workers.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined)
}

const installed = (worker: ServiceWorker): Promise<ServiceWorker | undefined> =>
  new Promise((resolve) => {
    const check = () => {
      if (worker.state === 'redundant') resolve(undefined)
      else if (worker.state !== 'installing' && worker.state !== 'parsed') resolve(worker)
    }
    worker.addEventListener('statechange', check)
    check()
  })

export const activateLatestWorker = async (): Promise<void> => {
  const workers = container()
  if (workers === undefined) return
  const registration = await workers.getRegistration().catch(() => undefined)
  if (registration === undefined) return
  await registration.update().catch(() => undefined)
  const candidate = registration.waiting ?? registration.installing ?? undefined
  if (candidate === undefined) return
  const worker = await Promise.race([installed(candidate), after(installTimeoutMs)])
  if (worker === undefined || worker.state !== 'installed') return
  const takenOver = new Promise<void>((resolve) =>
    workers.addEventListener('controllerchange', () => resolve(), { once: true }),
  )
  worker.postMessage(skipWaitingMessage)
  await Promise.race([takenOver, after(takeoverTimeoutMs)])
}

export const resetServiceWorker = async (): Promise<void> => {
  const registrations =
    (await container()
      ?.getRegistrations()
      .catch(() => [])) ?? []
  await Promise.all(registrations.map((registration) => registration.unregister()))
  if (typeof caches === 'undefined') return
  const names = await caches.keys().catch((): string[] => [])
  await Promise.all(
    names.filter((name) => name.startsWith('projo-')).map((name) => caches.delete(name)),
  )
}

export const reloadToLatest = async (): Promise<void> => {
  await activateLatestWorker()
  window.location.reload()
}

const session = (): Storage | undefined => {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

export const appUpdater = createUpdater({
  activateLatest: activateLatestWorker,
  resetWorker: resetServiceWorker,
  reload: () => window.location.reload(),
  attempts: {
    read: () => {
      try {
        return session()?.getItem(attemptKey) ?? undefined
      } catch {
        return undefined
      }
    },
    write: (value) => {
      try {
        session()?.setItem(attemptKey, value)
      } catch {}
    },
    clear: () => {
      try {
        session()?.removeItem(attemptKey)
      } catch {}
    },
  },
})
