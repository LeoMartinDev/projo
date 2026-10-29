/**
 * Document Picture-in-Picture (Chromium desktop): a PiP window holding our own HTML, so the
 * player's subtitles show in it (Chromium's video PiP draws the frames only). The `<video>` moves
 * into the window and back; the browser's own controls stand in for the player's chrome there.
 */

type DocumentPictureInPicture = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>
}

const documentPictureInPicture = (): DocumentPictureInPicture | undefined =>
  (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture

/**
 * An embedded Chromium (Electron) has the API but no PiP window ("no window"); the refusal uses
 * up the click's activation, so the video's own PiP serves from the next click on.
 */
let refused = false

export const documentPictureInPictureSupported = (): boolean =>
  !refused && typeof window !== 'undefined' && documentPictureInPicture() !== undefined

const windowWidth = 480

/**
 * Opens the window (needs the click's user activation) with the page's styles and an empty
 * `.player` stage. Undefined when the browser refuses it.
 */
export const openDocumentPictureInPicture = async (
  video: HTMLVideoElement,
): Promise<HTMLElement | undefined> => {
  const api = documentPictureInPicture()
  if (api === undefined) return undefined
  const ratio =
    video.videoWidth > 0 && video.videoHeight > 0 ? video.videoHeight / video.videoWidth : 9 / 16
  const pipWindow = await api
    .requestWindow({ width: windowWidth, height: Math.round(windowWidth * ratio) })
    .catch(() => undefined)
  if (pipWindow === undefined) {
    refused = true
    return undefined
  }
  const target = pipWindow.document
  target.documentElement.lang = document.documentElement.lang
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode instanceof Element) target.head.append(sheet.ownerNode.cloneNode(true))
  }
  const stage = target.createElement('div')
  stage.className = 'player'
  target.body.append(stage)
  return stage
}

/**
 * Moves `video` onto the stage, back to its place in the page when the window closes
 * (`onClosed`) or on cleanup, which also closes the window.
 */
export const showInDocumentPictureInPicture = (
  stage: HTMLElement,
  video: HTMLVideoElement,
  onClosed: () => void,
): (() => void) => {
  const home = video.parentElement
  const pipWindow = stage.ownerDocument.defaultView
  // Moved within one task: the element stays in a document and keeps playing.
  stage.prepend(video)
  video.controls = true
  video.disablePictureInPicture = true
  const back = () => {
    video.controls = false
    video.disablePictureInPicture = false
    home?.prepend(video)
  }
  const closed = () => {
    back()
    onClosed()
  }
  pipWindow?.addEventListener('pagehide', closed, { once: true })
  return () => {
    pipWindow?.removeEventListener('pagehide', closed)
    back()
    pipWindow?.close()
  }
}
