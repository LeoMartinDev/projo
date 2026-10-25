import type { PlaybackSessionDto, SubtitleTrackDto } from '@projo/shared/api/playback'

/**
 * Text subtitles (§10.4): WebVTT tracks are rendered by the player itself (size, position above
 * the chrome), the delay is applied by shifting the cues. Bitmap tracks are burnt in by a new
 * session. Pure.
 */

// ── Cue text ─────────────────────────────────────────────────────────────────

export type CueRun = { text: string; italic: boolean; bold: boolean; underline: boolean }
export type CueLine = CueRun[]

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  lrm: '‎',
  rlm: '‏',
  quot: '"',
  apos: "'",
}

/** A Unicode scalar value: 1 to 0x10FFFF, surrogates excluded (`fromCodePoint` throws above). */
const isScalar = (code: number) =>
  Number.isInteger(code) && code > 0 && code <= 0x10_ff_ff && (code < 0xd8_00 || code > 0xdf_ff)

const numericCode = (name: string) => {
  const hex = name[1] === 'x' || name[1] === 'X'
  const digits = name.slice(hex ? 2 : 1)
  if (!(hex ? /^[0-9a-f]+$/i : /^[0-9]+$/).test(digits)) return undefined
  const code = Number.parseInt(digits, hex ? 16 : 10)
  return isScalar(code) ? code : undefined
}

/** Named and numeric entities; an unknown, invalid or out of range one is kept as written. */
const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith('#')) {
      const code = numericCode(name)
      return code === undefined ? match : String.fromCodePoint(code)
    }
    return entities[name.toLowerCase()] ?? match
  })

/**
 * Lines of a WebVTT cue, with `<i>`, `<b>`, `<u>` kept as styles and every other tag (`<c.x>`,
 * `<v Name>`, timestamps, ruby) dropped. Entities are decoded. Empty runs are left out.
 */
export const parseCueText = (text: string): CueLine[] => {
  const style = { italic: 0, bold: 0, underline: 0 }
  return text.split(/\r?\n/).map((line) => {
    const runs: CueLine = []
    for (const token of line.split(/(<[^>]*>)/)) {
      if (token.startsWith('<')) {
        const tag = /^<(\/?)([a-z]+)/i.exec(token) ?? undefined
        const step = tag?.[1] === '/' ? -1 : 1
        const name = (tag?.[2] ?? '').toLowerCase()
        if (name === 'i') style.italic = Math.max(0, style.italic + step)
        if (name === 'b') style.bold = Math.max(0, style.bold + step)
        if (name === 'u') style.underline = Math.max(0, style.underline + step)
        continue
      }
      const value = decode(token)
      if (value === '') continue
      runs.push({
        text: value,
        italic: style.italic > 0,
        bold: style.bold > 0,
        underline: style.underline > 0,
      })
    }
    return runs
  })
}

// ── Delay and size (per device, §10.4) ───────────────────────────────────────

export const subtitleDelayStepMs = 250
export const subtitleDelayLimitMs = 10_000

export const clampDelay = (delayMs: number) =>
  Math.round(
    Math.min(
      subtitleDelayLimitMs,
      Math.max(-subtitleDelayLimitMs, Number.isFinite(delayMs) ? delayMs : 0),
    ),
  )

/** A positive delay shows the subtitles later. Times in seconds, never below 0. */
export const shiftCue = (original: { start: number; end: number }, delayMs: number) => ({
  start: Math.max(0, original.start + delayMs / 1000),
  end: Math.max(0, original.end + delayMs / 1000),
})

export const subtitleSizes = ['small', 'medium', 'large', 'xlarge'] as const
export type SubtitleSize = (typeof subtitleSizes)[number]

export const isSubtitleSize = (value: unknown): value is SubtitleSize =>
  typeof value === 'string' && (subtitleSizes as readonly string[]).includes(value)

// ── Track choices ────────────────────────────────────────────────────────────

/** What the subtitle menu offers: off, or a track of the session. */
export type SubtitleChoice = { kind: 'off' } | { kind: 'track'; track: SubtitleTrackDto }

/**
 * Picking a subtitle track needs a new session when it must be burnt in, or when the current
 * session burns one in (its video carries it). A WebVTT track or "off" is switched in place.
 */
export const needsNewSession = (
  session: Pick<PlaybackSessionDto, 'burnIn'>,
  choice: SubtitleChoice,
): boolean => session.burnIn || (choice.kind === 'track' && choice.track.delivery === 'burn_in')

export const canChoose = (track: SubtitleTrackDto) => track.delivery !== 'unsupported'

/** The selected track if it is a WebVTT one (the `<track>` to render). */
export const vttTrackOf = (
  tracks: readonly SubtitleTrackDto[],
  selectedId: string | undefined,
): SubtitleTrackDto | undefined => {
  const track = tracks.find((candidate) => candidate.id === selectedId)
  return track?.delivery === 'vtt' && track.url !== undefined ? track : undefined
}

const sameLanguage = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && normalizeLanguage(a) === normalizeLanguage(b)

/** ISO 639-2/B and 639-2/T and 639-1 forms of the common languages, folded to 639-1. */
const languageAliases: Record<string, string> = {
  fre: 'fr',
  fra: 'fr',
  eng: 'en',
  ger: 'de',
  deu: 'de',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  jpn: 'ja',
  dut: 'nl',
  nld: 'nl',
  chi: 'zh',
  zho: 'zh',
  kor: 'ko',
  rus: 'ru',
}

export const normalizeLanguage = (code: string) => {
  const lower = code.toLowerCase().split(/[-_]/)[0] ?? ''
  return languageAliases[lower] ?? lower
}

/**
 * Target of `C` (subtitles on/off): off when on; otherwise the last track turned off in this
 * session, else a full (non-forced) track in the profile's language, else the first choosable.
 */
export const toggledSubtitle = ({
  tracks,
  selectedId,
  lastId,
  preferredLanguage,
}: {
  tracks: readonly SubtitleTrackDto[]
  selectedId: string | undefined
  lastId: string | undefined
  preferredLanguage: string | undefined
}): SubtitleChoice | undefined => {
  if (selectedId !== undefined) return { kind: 'off' }
  const choosable = tracks.filter(canChoose)
  const track =
    choosable.find((candidate) => candidate.id === lastId) ??
    choosable.find(
      (candidate) => !candidate.forced && sameLanguage(candidate.language, preferredLanguage),
    ) ??
    choosable.find((candidate) => !candidate.forced) ??
    choosable[0]
  return track === undefined ? undefined : { kind: 'track', track }
}
