/**
 * Origins of the desktop app's bundled UI (§28): `http://tauri.localhost` is Tauri's on Windows.
 * The server answers them with CORS on `/health` and `/api/v1/*` and accepts their mutating
 * requests without a session cookie (§20). A list, so another platform's origin can join it.
 */
export const desktopOrigins: readonly string[] = ['http://tauri.localhost']

export const isDesktopOrigin = (origin: string | undefined): boolean =>
  origin !== undefined && desktopOrigins.includes(origin)
