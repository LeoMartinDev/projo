export type DataPaths = {
  root: string
  db: { dir: string; file: string; backups: string }
  images: {
    dir: string
    posters: string
    backdrops: string
    logos: string
    stills: string
    custom: string
  }
  cache: {
    dir: string
    transcode: string
    trickplay: string
    subtitles: string
    keyframes: string
    previews: string
  }
  app: {
    dir: string
    versions: string
    staging: string
    current: string
    previous: string
    pending: string
    switchResult: string
  }
  logs: string
}

const join = (base: string, segment: string): string => `${base.replace(/\/+$/, '')}/${segment}`

export const dataPathsFor = (root: string): DataPaths => {
  const db = join(root, 'db')
  const images = join(root, 'images')
  const cache = join(root, 'cache')
  const app = join(root, 'app')
  return {
    root,
    db: { dir: db, file: join(db, 'projo.db'), backups: join(db, 'backups') },
    images: {
      dir: images,
      posters: join(images, 'posters'),
      backdrops: join(images, 'backdrops'),
      logos: join(images, 'logos'),
      stills: join(images, 'stills'),
      custom: join(images, 'custom'),
    },
    cache: {
      dir: cache,
      transcode: join(cache, 'transcode'),
      trickplay: join(cache, 'trickplay'),
      subtitles: join(cache, 'subtitles'),
      keyframes: join(cache, 'keyframes'),
      previews: join(cache, 'previews'),
    },
    app: {
      dir: app,
      versions: join(app, 'versions'),
      staging: join(app, 'staging'),
      current: join(app, 'current'),
      previous: join(app, 'previous'),
      pending: join(app, 'pending'),
      switchResult: join(app, 'switch-result.json'),
    },
    logs: join(root, 'logs'),
  }
}

export const requiredDirectories = (paths: DataPaths): string[] => [
  paths.db.dir,
  paths.db.backups,
  paths.images.posters,
  paths.images.backdrops,
  paths.images.logos,
  paths.images.stills,
  paths.images.custom,
  paths.cache.transcode,
  paths.cache.trickplay,
  paths.cache.subtitles,
  paths.cache.keyframes,
  paths.cache.previews,
  paths.app.versions,
  paths.app.staging,
  paths.logs,
]
