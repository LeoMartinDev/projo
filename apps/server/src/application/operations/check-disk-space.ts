import { DISK_LOW_THRESHOLD_BYTES } from '../../core/notifications/notification.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import type { DiskUsage } from '../../core/stats/stats.ts'

type Deps = {
  diskUsage: Pick<DiskUsage, 'fileSystem'>
  dataDir: string
  notifier: AdminNotifier
  thresholdBytes?: number
}

export const checkDiskSpaceFactory =
  ({ diskUsage, dataDir, notifier, thresholdBytes = DISK_LOW_THRESHOLD_BYTES }: Deps) =>
  async (): Promise<void> => {
    const fileSystem = await diskUsage.fileSystem(dataDir)
    if (fileSystem === undefined) return
    if (fileSystem.freeBytes >= thresholdBytes) {
      notifier.resolve({ kind: 'cache/disk_low', key: 'data' })
      return
    }
    notifier.notify({
      kind: 'cache/disk_low',
      severity: 'warning',
      key: 'data',
      context: { freeBytes: fileSystem.freeBytes, totalBytes: fileSystem.totalBytes },
    })
  }

export type CheckDiskSpace = ReturnType<typeof checkDiskSpaceFactory>
