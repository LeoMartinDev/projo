import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { supervisorError, type SupervisorError } from './errors'
import type { Logger } from './logger'
import { readManifest, verifyTree } from './manifest'
import { err, type Result } from './result'
import {
  pointLink,
  readInstalledVersion,
  versionDir,
  type AppLayout,
  type InstalledVersion,
} from './version-state'

export type InstallSeedDeps = { layout: AppLayout; seedDir: string; logger: Logger }

const TMP_PREFIX = '.tmp-'

const removeStaleTmpDirs = async (versionsDir: string): Promise<void> => {
  const entries = await readdir(versionsDir)
  await Promise.all(
    entries
      .filter((name) => name.startsWith(TMP_PREFIX))
      .map((name) => rm(join(versionsDir, name), { recursive: true, force: true })),
  )
}

/**
 * Installs the app bundle embedded in the image into `versions/<v>` and points `current` to it.
 * Reuses an existing `versions/<v>` when it matches the seed manifest.
 */
export const installSeedFactory =
  ({ layout, seedDir, logger }: InstallSeedDeps) =>
  async (): Promise<Result<InstalledVersion, SupervisorError>> => {
    const manifest = await readManifest(seedDir)
    if (!manifest.ok) {
      return err(
        supervisorError(
          'seed/missing',
          'No valid app bundle embedded in the image',
          { seedDir },
          manifest.error,
        ),
      )
    }
    const { version } = manifest.value
    const seedCheck = await verifyTree(seedDir, manifest.value)
    if (!seedCheck.ok) return seedCheck

    const target = versionDir(layout, version)
    try {
      await mkdir(layout.versionsDir, { recursive: true })
      await removeStaleTmpDirs(layout.versionsDir)

      const existing = await readInstalledVersion(layout, version)
      const reusable = existing.ok && (await verifyTree(target, existing.value.manifest)).ok
      if (reusable) {
        logger.info('seed already installed', { version })
      } else {
        const tmp = join(layout.versionsDir, `${TMP_PREFIX}${version}-${process.pid}`)
        await cp(seedDir, tmp, { recursive: true })
        const copyCheck = await verifyTree(tmp, manifest.value)
        if (!copyCheck.ok) {
          await rm(tmp, { recursive: true, force: true })
          return copyCheck
        }
        await rm(target, { recursive: true, force: true })
        await rename(tmp, target)
        logger.info('seed installed', { version, dir: target })
      }
    } catch (cause) {
      return err(
        supervisorError(
          'seed/install_failed',
          'Cannot install the embedded app bundle',
          { version, target },
          cause,
        ),
      )
    }

    const linked = await pointLink(layout, 'current', version)
    if (!linked.ok) return linked
    return readInstalledVersion(layout, version)
  }
