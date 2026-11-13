import type { PlayerEngine } from '@projo/player/core/engine'
import type { ReadableStore } from '@projo/player/core/store'
import type { SubtitleSize } from '@projo/player/core/subtitles'

export type WindowFullscreen = {
  active: ReadableStore<boolean>
  set: (fullscreen: boolean) => void
}

// A rectangle of the page's viewport, in CSS pixels.
export type PictureRect = { left: number; top: number; width: number; height: number }

/**
 * A playback engine as the web player sees it: the port of @projo/player plus
 * what only a page has. The UI decides on `capabilities`, never on which
 * engine it got (the composition in player-route.tsx picks it).
 */
export type WebPlayerEngine = PlayerEngine & {
  // What the player mounts in its video slot (the `<video>` of the browser
  // engine, an empty box for an engine drawing under the page: the box the
  // picture is placed in). The WebVTT `<track>` of the overlay subtitles goes
  // inside it.
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
  // The engine's window goes full screen, not the document (the desktop app,
  // §28.4: the webview cannot take its window full screen); undefined: the
  // document's full screen.
  windowFullscreen?: WindowFullscreen
  // An engine that `rendersBehindPage` (§10.7): its picture under the page.
  picture: {
    // A picture is under the page right now: the page lets it through.
    showing: ReadableStore<boolean>
    // Where the page wants the picture (the "Next episode" thumbnail);
    // undefined: the whole window.
    place: (rect: PictureRect | undefined) => void
  }
  // Subtitles the engine draws itself (`capabilities.subtitles === 'engine'`).
  engineSubtitles: {
    setSize: (size: SubtitleSize) => void
    // Distance from the bottom of the window to the bottom of the subtitles,
    // in CSS pixels (above the controls or the countdown bubble); 0: the
    // engine's own place.
    setBottom: (pixels: number) => void
  }
  // The player page went away: the engine gives back what only playback
  // holds (the desktop app's libmpv instance, §28.7). It can load again later.
  release: () => void
}
