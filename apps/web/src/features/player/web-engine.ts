import type { PlayerEngine } from '@projo/player/core/engine'
import type { ReadableStore } from '@projo/player/core/store'

/**
 * A playback engine as the web player sees it: the port of @projo/player plus
 * what only a page has. The UI decides on `capabilities`, never on which
 * engine it got (the composition in player-route.tsx picks it).
 */
export type WebPlayerEngine = PlayerEngine & {
  // What the player mounts in its video slot (the `<video>` of the browser
  // engine, nothing visible for an engine drawing under the page). The WebVTT
  // `<track>` of the overlay subtitles goes inside it.
  media: HTMLElement
  pictureInPicture: {
    // In Picture-in-Picture (the element's, or the document's window).
    active: ReadableStore<boolean>
    // The element of the document Picture-in-Picture window, where the page
    // shows its subtitles; undefined otherwise.
    stage: ReadableStore<HTMLElement | undefined>
    toggle: () => void
    // Closes the document Picture-in-Picture window, when the player goes away.
    leave: () => void
    // The system Picture-in-Picture shows the native text tracks (WebKit).
    showsTextTracks: () => boolean
  }
  airPlay: { available: ReadableStore<boolean>; showPicker: () => void }
  nativeFullscreen: { active: ReadableStore<boolean>; enter: () => void }
}
