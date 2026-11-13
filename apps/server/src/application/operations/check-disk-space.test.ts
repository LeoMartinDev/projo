import { describe, expect, test } from 'bun:test'

import { recordingOpenNotifications } from '../../../test/support/operations-world.ts'
import { checkDiskSpaceFactory } from './check-disk-space.ts'

describe('periodic checks (§15 notifications)', () => {
  test('cache/disk_low under 2 GB free, resolved once there is room', async () => {
    let free = 1024 ** 3
    const { notifier, open, log } = recordingOpenNotifications()
    const check = checkDiskSpaceFactory({
      diskUsage: { fileSystem: async () => ({ totalBytes: 100 * 1024 ** 3, freeBytes: free }) },
      dataDir: '/data',
      notifier,
    })
    await check()
    await check()
    expect(open.get('cache/disk_low|data')).toEqual({
      freeBytes: 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
    })
    free = 5 * 1024 ** 3
    await check()
    expect(open.size).toBe(0)
    expect(log).toHaveLength(2)
  })

  test('no file system information, no notification', async () => {
    const { notifier, log } = recordingOpenNotifications()
    await checkDiskSpaceFactory({
      diskUsage: { fileSystem: async () => undefined },
      dataDir: '/data',
      notifier,
    })()
    expect(log).toEqual([])
  })
})
