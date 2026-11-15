import { compareSemVer, parseSemVer } from '@projo/shared/semver'

import desktopPackage from '../../package.json' with { type: 'json' }

/**
 * The oldest projo server the bundled UI works with (§28.3): the first one serving it as a
 * cross-origin API client (CORS, bearer sign-in, media key). Kept in `apps/desktop/package.json`
 * (`projo.minimumServerVersion`), where CI reads it too: a desktop release waits for the server
 * release `v<minimum>` (§28.10). Like the mobile app's `minimumServerVersion`: raise it when the
 * desktop UI relies on a newer server; lower it only locally to try an unreleased server.
 */
export const minimumServerVersion: string = desktopPackage.projo.minimumServerVersion

/**
 * Whether a server of `version` is recent enough: at least `minimum`, a pre-release of it being
 * older. An unreadable version is not.
 */
export const isServerCompatible = (version: string, minimum = minimumServerVersion): boolean => {
  const actual = parseSemVer(version)
  const floor = parseSemVer(minimum)
  if (actual === undefined || floor === undefined) return false
  return compareSemVer(actual, floor) >= 0
}
