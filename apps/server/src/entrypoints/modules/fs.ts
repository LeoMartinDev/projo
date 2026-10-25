import { browseDirectoriesFactory } from '../../application/fs/browse-directories.ts'
import { createNodeFileSystem } from '../../infrastructure/fs/node-file-system.ts'
import { adminFsRoutes } from '../http/routes/admin-fs.ts'
import type { Platform } from './platform.ts'

/** Wiring of the server-side directory picker (§7.1, §20). */
export const buildFsModule = (_platform: Platform) => ({
  routes: adminFsRoutes({
    browseDirectories: browseDirectoriesFactory({ fileSystem: createNodeFileSystem() }),
  }),
})
