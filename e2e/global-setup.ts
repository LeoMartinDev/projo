import { generateLibraries } from './support/library.ts'
import { generatePlaybackLibraries } from './support/playback-library.ts'

/** Runs after the servers are up (Playwright starts `webServer` first): they never read it. */
export default function globalSetup(): void {
  generateLibraries()
  generatePlaybackLibraries()
}
