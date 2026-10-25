import { generateLibraries } from './support/library.ts'
import { generatePlaybackLibrary } from './support/playback-library.ts'

/** Runs after the server is up (Playwright starts `webServer` first): it never reads it. */
export default function globalSetup(): void {
  generateLibraries()
  generatePlaybackLibrary()
}
