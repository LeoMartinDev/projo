/**
 * Time fields of the markers dialog (§12.5): `m:ss`, `h:mm:ss` or plain seconds, with an optional
 * fraction (`1:23.5`, `1:23,5`). Pure: tests run in Bun.
 */

const timecodePattern = /^(?:(\d+):)??(?:(\d+):)?(\d+)(?:[.,](\d{1,3}))?$/u

/** Milliseconds, or `undefined` when the text is not a time (`1:75`, `1:2:3:4`, `abc`). */
export const parseTimecode = (text: string): number | undefined => {
  const match = timecodePattern.exec(text.trim()) ?? undefined
  if (match === undefined) return undefined
  const [, hoursText, minutesText, secondsText = '0', fractionText] = match
  const hours = hoursText === undefined ? 0 : Number(hoursText)
  const minutes = minutesText === undefined ? 0 : Number(minutesText)
  const seconds = Number(secondsText)
  // `75` alone is 75 s; `1:75` is a typo, as is `1:75:00`.
  if (minutesText !== undefined && seconds >= 60) return undefined
  if (hoursText !== undefined && minutes >= 60) return undefined
  const fraction = fractionText === undefined ? 0 : Number(fractionText.padEnd(3, '0'))
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction
}

const pad = (value: number) => String(value).padStart(2, '0')

/** `0:42`, `1:23.5`, `1:02:03`: whole seconds, or tenths when the position has some. */
export const formatTimecode = (ms: number): string => {
  const tenths = Math.round(Math.max(0, ms) / 100)
  const total = Math.floor(tenths / 10)
  const fraction = tenths % 10
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock =
    hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
  return fraction === 0 ? clock : `${clock}.${fraction}`
}
