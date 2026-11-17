import { type CSSProperties, useEffect, useState } from 'react'

import {
  type CueLine,
  parseCueText,
  shiftCue,
  type SubtitleSize,
} from '@projo/player/core/subtitles'

import { pictureBottomInset } from './caption-placement.ts'

const originals = new WeakMap<TextTrackCue, { start: number; end: number }>()

const applyCueDelay = (track: TextTrack, delayMs: number): void => {
  const cues = track.cues
  if (!cues) return
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]
    if (cue === undefined) continue
    const original = originals.get(cue) ?? { start: cue.startTime, end: cue.endTime }
    originals.set(cue, original)
    const shifted = shiftCue(original, delayMs)
    cue.startTime = shifted.start
    cue.endTime = shifted.end
  }
}

const activeCues = (track: TextTrack): CueLine[][] => {
  const cues = track.activeCues
  if (!cues) return []
  const texts: CueLine[][] = []
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index] as (TextTrackCue & { text?: string }) | undefined
    if (cue?.text !== undefined) texts.push(parseCueText(cue.text))
  }
  return texts
}

const setMode = (track: TextTrack, mode: TextTrackMode): void => {
  track.mode = mode
}

const showTrack = (element: HTMLTrackElement, native: boolean): void => {
  setMode(element.track, 'showing')
  element.parentElement?.classList.toggle('player__video--native-cues', native)
}

// Bottom of the picture in an upright player (caption-placement.ts), kept up
// to date as the player turns or the video's size changes.
const usePictureInset = (video: HTMLVideoElement | undefined): number | undefined => {
  const [inset, setInset] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (video === undefined) return
    const update = () =>
      setInset(
        pictureBottomInset({
          boxWidth: video.clientWidth,
          boxHeight: video.clientHeight,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        }),
      )
    update()
    const observer = new ResizeObserver(update)
    observer.observe(video)
    video.addEventListener('loadedmetadata', update)
    video.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      video.removeEventListener('loadedmetadata', update)
      video.removeEventListener('resize', update)
    }
  }, [video])

  return inset
}

export const SubtitleOverlay = ({
  element,
  delayMs,
  size,
  raised,
  aboveToast,
  native,
}: {
  element: HTMLTrackElement | undefined
  delayMs: number
  size: SubtitleSize
  raised: boolean
  aboveToast: boolean
  native: boolean
}) => {
  const [cues, setCues] = useState<CueLine[][]>([])
  const media = element?.parentElement
  const pictureInset = usePictureInset(media instanceof HTMLVideoElement ? media : undefined)

  useEffect(() => {
    if (element === undefined) return
    const track = element.track
    showTrack(element, native)
    const update = () => setCues(native ? [] : activeCues(track))
    const loaded = () => {
      applyCueDelay(track, delayMs)
      update()
    }
    loaded()
    element.addEventListener('load', loaded)
    track.addEventListener('cuechange', update)
    return () => {
      element.removeEventListener('load', loaded)
      track.removeEventListener('cuechange', update)
    }
  }, [element, delayMs, native])

  useEffect(
    () => () => {
      if (element !== undefined) setMode(element.track, 'disabled')
    },
    [element],
  )

  if (element === undefined || native || cues.length === 0) return undefined
  return (
    <div
      className={`captions captions--${size}${aboveToast ? ' captions--above-toast' : raised ? ' captions--raised' : ''}${pictureInset === undefined ? '' : ' captions--on-picture'}`}
      style={
        pictureInset === undefined
          ? undefined
          : ({ '--captions-picture-bottom': `${pictureInset}px` } as CSSProperties)
      }
      aria-hidden="true"
    >
      {cues.map((lines, cueIndex) => (
        <p key={cueIndex} className="captions__cue">
          {lines.map((runs, lineIndex) => (
            <span key={lineIndex} className="captions__line">
              {runs.map((run, runIndex) => (
                <span
                  key={runIndex}
                  className={[
                    run.italic ? 'captions__i' : '',
                    run.bold ? 'captions__b' : '',
                    run.underline ? 'captions__u' : '',
                  ]
                    .filter((name) => name !== '')
                    .join(' ')}
                >
                  {run.text}
                </span>
              ))}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}
