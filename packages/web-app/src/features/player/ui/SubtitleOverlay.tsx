import { useEffect, useState } from 'react'

import {
  type CueLine,
  parseCueText,
  shiftCue,
  type SubtitleSize,
} from '@projo/player/core/subtitles'

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
      className={`captions captions--${size}${aboveToast ? ' captions--above-toast' : raised ? ' captions--raised' : ''}`}
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
