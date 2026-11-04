import { generateLibraries } from './support/library.ts'
import { generatePlaybackLibrary } from './support/playback-library.ts'

export default function globalSetup(): void {
  generateLibraries()
  generatePlaybackLibrary()
}
