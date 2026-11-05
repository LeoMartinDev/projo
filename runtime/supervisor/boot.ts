import { access, constants, mkdir, rm } from 'node:fs/promises'
import { supervisorError, type SupervisorError } from './errors'
import { errorFields, type Logger } from './logger'
import { err, ok, type Result } from './result'
import { satisfiesMinimum } from './semver'
import { readAppState, type AppLayout, type InstalledVersion } from './version-state'

export type PrepareAppDeps = {
  layout: AppLayout
  runtimeVersion: string
  installSeed: () => Promise<Result<InstalledVersion, SupervisorError>>
  logger: Logger
}

/**
 * Resolves the version to launch: `current` when valid, otherwise the seed embedded in the image
 * (first start, or recovery from a broken link).
 */
export const prepareAppFactory =
  ({ layout, runtimeVersion, installSeed, logger }: PrepareAppDeps) =>
  async (): Promise<Result<InstalledVersion, SupervisorError>> => {
    try {
      await mkdir(layout.appDir, { recursive: true })
      await access(layout.appDir, constants.W_OK)
    } catch (cause) {
      return err(
        supervisorError(
          'data/not_writable',
          'Data directory is not writable by the projo user',
          { appDir: layout.appDir },
          cause,
        ),
      )
    }

    const state = await readAppState(layout)
    if (state.pending !== undefined) {
      // Only an exit 75 starts a switch: a `pending` found at boot was left by an interrupted
      // one (container stopped in between). The app settles its pending run at startup.
      logger.warn('stale pending switch dropped', {
        code: 'update/switch_interrupted',
        pending: state.pending,
      })
      await rm(layout.pendingFile, { force: true }).catch(() => undefined)
    }

    if (state.current.kind === 'invalid') {
      logger.error(
        'current app version is unusable, reinstalling the embedded one',
        errorFields(state.current.error),
      )
    } else if (state.current.kind === 'missing') {
      logger.info('no app installed, installing the embedded one')
    }
    const resolved = state.current.kind === 'ok' ? ok(state.current.installed) : await installSeed()
    if (!resolved.ok) return resolved

    const { version, manifest } = resolved.value
    if (satisfiesMinimum(runtimeVersion, manifest.runtimeMin) === false) {
      logger.warn('app requires a newer runtime image', {
        code: 'update/runtime_too_old',
        version,
        runtimeMin: manifest.runtimeMin,
        runtimeVersion,
      })
    }
    return resolved
  }
