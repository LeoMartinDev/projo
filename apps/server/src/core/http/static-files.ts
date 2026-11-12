export type StaticFile = { path: string; file: Blob }

export type StaticFiles = {
  resolve: (pathname: string) => StaticFile | undefined
}
