import { useEffect, useState } from 'react'

import { type CueLine, parseCueText, shiftCue, type SubtitleSize } from './subtitles.ts'

// ── DOM helpers (outside components: React Compiler forbids mutating hook values) ──

const originals = new WeakMap<TextTrackCue, { start: number; end: number }>()

/** Shifts every loaded cue of `track` by `delayMs` from its original times. */
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

/**
 * The selected WebVTT track (§10.4), drawn by the player: its `<track>` stays `hidden` and the
 * active cues are rendered here, at the chosen size, above the chrome when it is shown. In the
 * native fullscreen of iOS (`native`), the browser draws them itself. The delay shifts the cues.
 * Mount it with `key` = the track, so a new track starts empty.
 */
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
    setMode(track, native ? 'showing' : 'hidden')
    const update = () => setCues(native ? [] : activeCues(track))
    const loaded = () => {
      applyCueDelay(track, delayMs)
      update()
    }
    applyCueDelay(track, delayMs)
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
