/**
 * Origins of the desktop app's bundled UI (§28): Tauri serves it at `http://tauri.localhost` on
 * Windows and at `tauri://localhost` on macOS. The server answers them with CORS on `/health` and
 * `/api/v1/*` and accepts their mutating requests without a session cookie (§20).
 */
export const desktopOrigins: readonly string[] = ['http://tauri.localhost', 'tauri://localhost']

export const isDesktopOrigin = (origin: string | undefined): boolean =>
  origin !== undefined && desktopOrigins.includes(origin)
