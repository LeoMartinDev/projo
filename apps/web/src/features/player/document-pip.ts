type DocumentPictureInPicture = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>
}

const documentPictureInPicture = (): DocumentPictureInPicture | undefined =>
  (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture

let refused = false

export const documentPictureInPictureSupported = (): boolean =>
  !refused && typeof window !== 'undefined' && documentPictureInPicture() !== undefined

const windowWidth = 480

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

export const showInDocumentPictureInPicture = (
  stage: HTMLElement,
  video: HTMLVideoElement,
  onClosed: () => void,
): (() => void) => {
  const home = video.parentElement
  const pipWindow = stage.ownerDocument.defaultView
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
