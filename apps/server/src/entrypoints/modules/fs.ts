import { browseDirectoriesFactory } from '../../application/fs/browse-directories.ts'
import { createNodeFileSystem } from '../../infrastructure/fs/node-file-system.ts'
import { adminFsRoutes } from '../http/routes/admin-fs.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export const buildFsModule = (_platform: Platform) =>
  defineModule({
    exposes: {
      routes: adminFsRoutes({
        browseDirectories: browseDirectoriesFactory({ fileSystem: createNodeFileSystem() }),
      }),
    },
  })
