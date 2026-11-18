import type { TvUpstream } from '../../../core/tv/channel.ts'
import type { TvProviderChannel } from '../../../core/tv/provider.ts'

/** What a playlist holds (§29.2, "M3U in detail"). */
export type M3uPlaylist = {
  /** The first non-empty line is `#EXTM3U`. */
  header: boolean
  /** Number of `#EXTINF` lines, kept or not. */
  entries: number
  /** The header's `url-tvg` / `x-tvg-url` (its first URL). */
  guideUrl?: string
  channels: TvProviderChannel[]
}

const liveSchemes = /^(?:https?|rtsp|rtp|udp):\/\//iu

const fileExtensions = new Set([
  'mkv',
  'mp4',
  'm4v',
  'avi',
  'mov',
  'wmv',
  'flv',
  'webm',
  'mpg',
  'mpeg',
  'divx',
  'ogv',
  '3gp',
  'iso',
])

const audioExtensions = new Set(['mp3', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'wav'])

const collapse = (value: string): string => value.replace(/\s+/gu, ' ').trim()

/** `key="value"`, `key='value'` or `key=value` pairs; keys lowercased. */
export const parseAttributes = (text: string): Map<string, string> => {
  const attributes = new Map<string, string>()
  const pattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',]+))/gu
  for (const match of text.matchAll(pattern)) {
    const [, key, double, single, bare] = match
    if (key === undefined) continue
    attributes.set(key.toLowerCase(), (double ?? single ?? bare ?? '').trim())
  }
  return attributes
}

/** Index of the first comma outside quotes, or -1. */
const titleComma = (text: string): number => {
  let quote: string | undefined
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== undefined) {
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") quote = char
    else if (char === ',') return index
  }
  return -1
}

const pathOf = (url: string): string | undefined => {
  if (!URL.canParse(url)) return undefined
  return new URL(url).pathname.toLowerCase()
}

const extensionOf = (path: string): string | undefined => {
  const last = path.split('/').at(-1) ?? ''
  const dot = last.lastIndexOf('.')
  return dot <= 0 ? undefined : last.slice(dot + 1)
}

/** A file (VOD), not a live channel (§29.2). */
export const isFileUrl = (url: string): boolean => {
  const path = pathOf(url)
  if (path === undefined) return false
  const extension = extensionOf(path)
  if (extension !== undefined && fileExtensions.has(extension)) return true
  return path.split('/').some((segment) => segment === 'movie' || segment === 'series')
}

const isAudioUrl = (url: string): boolean => {
  const path = pathOf(url)
  const extension = path === undefined ? undefined : extensionOf(path)
  return extension !== undefined && audioExtensions.has(extension)
}

const isHttpUrl = (value: string): boolean => /^https?:\/\//iu.test(value) && URL.canParse(value)

const positiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined
  const number = Number(value)
  return number > 0 && Number.isSafeInteger(number) ? number : undefined
}

export const channelKeyOf = ({
  guideKey,
  group,
  name,
}: {
  guideKey?: string
  group: string
  name: string
}): string => (guideKey === undefined ? `name:${group}|${name}` : `tvg:${guideKey}|${name}`)

type PendingEntry = { attributes: Map<string, string>; title: string }

/**
 * A line-by-line M3U parser: `push` every line (without its line break), then `finish`. Keeps
 * only what a live channel needs, so a playlist of any size is read as a stream.
 */
export const createM3uParser = () => {
  let firstLine = true
  let header = false
  let entries = 0
  let guideUrl: string | undefined
  let lastGroup: string | undefined
  let pending: PendingEntry | undefined
  let userAgent: string | undefined
  let referrer: string | undefined
  const channels: TvProviderChannel[] = []
  const keys = new Set<string>()

  const resetEntry = () => {
    pending = undefined
    userAgent = undefined
    referrer = undefined
  }

  const readHeader = (line: string) => {
    header = true
    const attributes = parseAttributes(line.slice('#EXTM3U'.length))
    const urls = attributes.get('url-tvg') ?? attributes.get('x-tvg-url')
    const first = urls
      ?.split(',')
      .map((url) => url.trim())
      .find(isHttpUrl)
    if (first !== undefined) guideUrl = first
  }

  const readEntry = (line: string) => {
    entries += 1
    const body = line.slice('#EXTINF:'.length)
    const comma = titleComma(body)
    const head = comma === -1 ? body : body.slice(0, comma)
    const title = comma === -1 ? '' : body.slice(comma + 1)
    userAgent = undefined
    referrer = undefined
    pending = { attributes: parseAttributes(head), title }
  }

  const readOption = (line: string) => {
    const option = line.slice('#EXTVLCOPT:'.length).trim()
    const equals = option.indexOf('=')
    if (equals === -1) return
    const name = option.slice(0, equals).trim().toLowerCase()
    const value = option.slice(equals + 1).trim()
    if (value === '') return
    if (name === 'http-user-agent') userAgent = value
    else if (name === 'http-referrer' || name === 'http-referer') referrer = value
  }

  const readUrl = (url: string) => {
    const entry = pending
    const upstream: TvUpstream = {
      url,
      ...(userAgent === undefined ? {} : { userAgent }),
      ...(referrer === undefined ? {} : { referrer }),
    }
    resetEntry()
    if (entry === undefined) return
    const { attributes } = entry
    const name = collapse(entry.title) || collapse(attributes.get('tvg-name') ?? '')
    if (name === '') return
    if (!liveSchemes.test(url) || isFileUrl(url)) return
    if (attributes.get('radio')?.toLowerCase() === 'true' || isAudioUrl(url)) return
    const group = collapse(attributes.get('group-title') ?? '') || lastGroup || ''
    const guideKey = attributes.get('tvg-id') || undefined
    const number = positiveInteger(attributes.get('tvg-chno'))
    const logo = attributes.get('tvg-logo')
    const key = channelKeyOf({ ...(guideKey === undefined ? {} : { guideKey }), group, name })
    if (keys.has(key)) return
    keys.add(key)
    channels.push({
      key,
      name,
      ...(number === undefined ? {} : { number }),
      group,
      ...(logo !== undefined && isHttpUrl(logo) ? { logoUrl: logo } : {}),
      upstream,
      ...(guideKey === undefined ? {} : { guideKey }),
    })
  }

  return {
    push: (raw: string) => {
      const line = (firstLine ? raw.replace(/^﻿/u, '') : raw).trim()
      if (line === '') return
      if (firstLine) {
        firstLine = false
        if (line.toUpperCase().startsWith('#EXTM3U')) {
          readHeader(line)
          return
        }
      }
      if (line.startsWith('#')) {
        const upper = line.toUpperCase()
        if (upper.startsWith('#EXTINF:')) readEntry(line)
        else if (upper.startsWith('#EXTVLCOPT:')) readOption(line)
        else if (upper.startsWith('#EXTGRP:'))
          lastGroup = collapse(line.slice('#EXTGRP:'.length)) || undefined
        return
      }
      readUrl(line)
    },
    finish: (): M3uPlaylist => ({
      header,
      entries,
      ...(guideUrl === undefined ? {} : { guideUrl }),
      channels,
    }),
  }
}

/** Parses a whole playlist (tests, small inputs). */
export const parseM3u = (text: string): M3uPlaylist => {
  const parser = createM3uParser()
  for (const line of text.split(/\r?\n|\r/u)) parser.push(line)
  return parser.finish()
}
