import { browseDirectoriesFactory } from '../../application/fs/browse-directories.ts'
import { createNodeFileSystem } from '../../infrastructure/fs/node-file-system.ts'
import { adminFsRoutes } from '../http/routes/admin-fs.ts'
import type { Platform } from './platform.ts'

export const buildFsModule = (_platform: Platform) => ({
  routes: adminFsRoutes({
    browseDirectories: browseDirectoriesFactory({ fileSystem: createNodeFileSystem() }),
  }),
})
