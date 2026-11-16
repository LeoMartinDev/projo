import { type SubtitleTrackDto, subtitleRenditionNames } from '@projo/shared/api/playback'

import { shiftCue } from '@projo/player/core/subtitles'

// What the sidecar tracks use of the `<video>`.
export type TrackParent = {
  append: (element: HTMLTrackElement) => void
  addEventListener: (type: 'loadedmetadata', listener: () => void) => void
  removeEventListener: (type: 'loadedmetadata', listener: () => void) => void
}

export type SidecarTracks = {
  // The track shown, by its id; undefined: none.
  select: (trackId: string | undefined) => void
  // Moves the cues of every loaded track (positive: later).
  setDelay: (delayMs: number) => void
  detach: () => void
}

/**
 * The text subtitles of a session with `subtitleDelivery: 'track'` (§10.4), as `<track>`
 * children of the `<video>` that the browser draws itself (in its native full screen and
 * Picture-in-Picture too): one per WebVTT track of the session, labelled like the HLS renditions
 * (`subtitleRenditionNames`), the selected one `default` and showing, the others disabled (loaded
 * only once the browser's own menu picks one). The WebVTT is on the media timeline (the
 * `<video>`'s `currentTime`), so a cue only moves by the subtitle delay, applied to each track
 * as it loads and again on every change. The selection is applied again once the media's
 * metadata is there, over the browser's own automatic choice.
 */
export const attachSidecarTracks = ({
  video,
  tracks,
  selectedId,
  delayMs,
  resolveUrl,
  createTrack,
}: {
  video: TrackParent
  tracks: readonly SubtitleTrackDto[]
  selectedId: string | undefined
  delayMs: number
  resolveUrl: (url: string) => string
  createTrack: () => HTMLTrackElement
}): SidecarTracks => {
  const text = tracks.flatMap((track) =>
    track.delivery === 'vtt' && track.url !== undefined ? [{ ...track, url: track.url }] : [],
  )
  const names = subtitleRenditionNames(text)
  const originals = new WeakMap<TextTrackCue, { start: number; end: number }>()
  let delay = delayMs
  let selected = selectedId

  const shift = (element: HTMLTrackElement) => {
    const cues = element.track.cues
    if (!cues) return
    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index]
      if (cue === undefined) continue
      const original = originals.get(cue) ?? { start: cue.startTime, end: cue.endTime }
      originals.set(cue, original)
      const shifted = shiftCue(original, delay)
      cue.startTime = shifted.start
      cue.endTime = shifted.end
    }
  }

  const entries = text.map((track, index) => {
    const element = createTrack()
    element.kind = 'subtitles'
    element.label = names[index] ?? ''
    if (track.language !== undefined) element.srclang = track.language
    element.default = track.id === selectedId
    element.src = resolveUrl(track.url)
    const loaded = () => shift(element)
    element.addEventListener('load', loaded)
    video.append(element)
    return { id: track.id, element, loaded }
  })

  const apply = () => {
    for (const { id, element } of entries) {
      element.track.mode = id === selected ? 'showing' : 'disabled'
    }
  }
  apply()
  video.addEventListener('loadedmetadata', apply)

  return {
    select: (trackId) => {
      selected = trackId
      apply()
    },
    setDelay: (next) => {
      delay = next
      for (const { element } of entries) shift(element)
    },
    detach: () => {
      video.removeEventListener('loadedmetadata', apply)
      for (const { element, loaded } of entries) {
        element.removeEventListener('load', loaded)
        element.track.mode = 'disabled'
        element.remove()
      }
    },
  }
}
