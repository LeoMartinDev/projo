import { err, ok, type Result } from '@projo/shared'

import {
  parseXmltvTime,
  type TvGuideProgramme,
  type TvGuideSink,
  type TvGuideText,
} from '../../../core/tv/guide.ts'

/** A tag, comment or CDATA section still open past this many characters: not a guide (§29.3). */
export const XMLTV_MAX_TOKEN_CHARS = 1024 * 1024
/** Characters kept of one text field (cut further when cleaned, §29.3). */
const MAX_FIELD_CHARS = 16 * 1024

export type XmltvParseFailure = 'not_xmltv' | 'token_too_large'

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const codePoint = (value: number): string | undefined =>
  Number.isInteger(value) && value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)
    ? String.fromCodePoint(value)
    : undefined

/** The five XML entities and numeric references decoded; any other entity kept as written. */
export const decodeXmlEntities = (value: string): string =>
  value.includes('&')
    ? value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (whole, name: string) => {
        if (name.startsWith('#x') || name.startsWith('#X'))
          return codePoint(Number.parseInt(name.slice(2), 16)) ?? whole
        if (name.startsWith('#')) return codePoint(Number.parseInt(name.slice(1), 10)) ?? whole
        return entities[name] ?? whole
      })
    : value

const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu

const parseAttributes = (source: string): Map<string, string> => {
  const attributes = new Map<string, string>()
  for (const match of source.matchAll(attributePattern)) {
    const [, name = '', double, single] = match
    attributes.set(name, decodeXmlEntities(double ?? single ?? ''))
  }
  return attributes
}

/** Where a tag starting at `from` (its `<`) ends: the `>` outside quotes, or -1. */
const tagEnd = (text: string, from: number): number => {
  const first = text.indexOf('>', from)
  if (first === -1) return -1
  // Most tags hold no quoted `>`: the first one ends them.
  const head = text.slice(from, first)
  if (!head.includes('"') && !head.includes("'")) return first
  let quote = ''
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== '') {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  return -1
}

type Field = 'title' | 'sub-title' | 'desc' | 'category' | 'display-name'

const programmeFields = new Set<string>(['title', 'sub-title', 'desc', 'category'])

type OpenProgramme = {
  channel: string
  start: string
  stop?: string
  titles: TvGuideText[]
  subtitles: TvGuideText[]
  descriptions: TvGuideText[]
  categories: TvGuideText[]
}

/**
 * A streaming XMLTV reader (§29.3): text is pushed chunk by chunk (a tag cut between two chunks
 * waits for its end) and never held whole; only `<channel>` with its display names and
 * `<programme>` with its title, subtitle, description and category reach the sink, every other
 * element is skipped. Comments, processing instructions and the DOCTYPE are skipped; CDATA is
 * text. A tag left open past 1 MB, or a first element other than `<tv>`, fails the read.
 */
export const createXmltvParser = (sink: TvGuideSink) => {
  let buffer = ''
  let failure: XmltvParseFailure | undefined
  let rootSeen = false
  let depth = 0
  let channel: { id: string; names: string[] } | undefined
  let programme: OpenProgramme | undefined
  let field: { name: Field; lang?: string; depth: number; text: string } | undefined

  const appendText = (text: string) => {
    if (field === undefined || field.text.length >= MAX_FIELD_CHARS) return
    field.text += text.slice(0, MAX_FIELD_CHARS - field.text.length)
  }
  // Text between tags: decoded only when a field collects it.
  const appendRaw = (raw: string) => {
    if (field !== undefined) appendText(decodeXmlEntities(raw))
  }

  const closeField = () => {
    if (field === undefined) return
    const text: TvGuideText = {
      text: field.text,
      ...(field.lang === undefined ? {} : { lang: field.lang }),
    }
    if (field.name === 'display-name') channel?.names.push(field.text)
    else if (programme !== undefined) {
      if (field.name === 'title') programme.titles.push(text)
      else if (field.name === 'sub-title') programme.subtitles.push(text)
      else if (field.name === 'desc') programme.descriptions.push(text)
      else programme.categories.push(text)
    }
    field = undefined
  }

  const emitProgramme = (open: OpenProgramme) => {
    const start = parseXmltvTime(open.start)
    if (start === undefined || open.channel === '') return
    const stop = open.stop === undefined ? undefined : parseXmltvTime(open.stop)
    const read: TvGuideProgramme = {
      channel: open.channel,
      start,
      ...(stop === undefined ? {} : { stop }),
      titles: open.titles,
      subtitles: open.subtitles,
      descriptions: open.descriptions,
      categories: open.categories,
    }
    sink.programme(read)
  }

  const startElement = (name: string, attributeSource: string, selfClosing: boolean) => {
    if (!rootSeen) {
      if (name !== 'tv') {
        failure = 'not_xmltv'
        return
      }
      rootSeen = true
    }
    const level = depth + 1
    if (level === 2 && name === 'channel') {
      channel = { id: parseAttributes(attributeSource).get('id') ?? '', names: [] }
    } else if (level === 2 && name === 'programme') {
      const attributes = parseAttributes(attributeSource)
      const stop = attributes.get('stop')
      programme = {
        channel: attributes.get('channel') ?? '',
        start: attributes.get('start') ?? '',
        ...(stop === undefined ? {} : { stop }),
        titles: [],
        subtitles: [],
        descriptions: [],
        categories: [],
      }
    } else if (
      level === 3 &&
      field === undefined &&
      ((channel !== undefined && name === 'display-name') ||
        (programme !== undefined && programmeFields.has(name)))
    ) {
      const lang = parseAttributes(attributeSource).get('lang')
      field = {
        name: name as Field,
        depth: level,
        text: '',
        ...(lang === undefined ? {} : { lang }),
      }
    }
    if (selfClosing) endElement(level)
    else depth = level
  }

  const endElement = (level: number) => {
    if (field !== undefined && field.depth === level) closeField()
    if (level === 2 && channel !== undefined) {
      if (channel.id !== '') sink.channel(channel)
      channel = undefined
    }
    if (level === 2 && programme !== undefined) {
      const open = programme
      programme = undefined
      emitProgramme(open)
    }
    depth = level - 1
  }

  /** Consumes what the buffer holds whole; the rest waits for the next chunk. */
  const consume = (final: boolean) => {
    let position = 0
    const text = buffer
    while (failure === undefined && position < text.length) {
      const open = text.indexOf('<', position)
      if (open === -1) {
        // Text up to the end, but not a cut entity (`&am`): it waits for its `;`.
        const ampersand = text.lastIndexOf('&')
        const cut =
          !final && ampersand >= position && text.indexOf(';', ampersand) === -1
            ? ampersand
            : text.length
        if (text.length - cut > 32) {
          appendRaw(text.slice(position))
          position = text.length
        } else {
          appendRaw(text.slice(position, cut))
          position = cut
        }
        break
      }
      if (open > position) appendRaw(text.slice(position, open))
      position = open
      let end: number
      if (text.startsWith('<!--', open)) {
        const close = text.indexOf('-->', open + 4)
        end = close === -1 ? -1 : close + 3
      } else if (text.startsWith('<![CDATA[', open)) {
        const close = text.indexOf(']]>', open + 9)
        if (close !== -1) appendText(text.slice(open + 9, close))
        end = close === -1 ? -1 : close + 3
      } else if (text.startsWith('<?', open)) {
        const close = text.indexOf('?>', open + 2)
        end = close === -1 ? -1 : close + 2
      } else if (text.startsWith('<!', open)) {
        // DOCTYPE, with an internal subset in brackets when it has one.
        const bracket = text.indexOf('[', open)
        const close = text.indexOf('>', open)
        if (bracket !== -1 && (close === -1 || bracket < close)) {
          // `]>`, or `] >` with whitespace between them.
          const subsetEnd = text.slice(bracket).search(/\]\s*>/u)
          end = subsetEnd === -1 ? -1 : text.indexOf('>', bracket + subsetEnd) + 1
        } else end = close === -1 ? -1 : close + 1
      } else {
        const close = tagEnd(text, open)
        if (close !== -1) {
          const inner = text.slice(open + 1, close)
          if (inner.startsWith('/')) {
            if (depth > 0) endElement(depth)
          } else {
            const selfClosing = inner.endsWith('/')
            const body = selfClosing ? inner.slice(0, -1) : inner
            const nameEnd = body.search(/[\s]/u)
            const name = nameEnd === -1 ? body : body.slice(0, nameEnd)
            startElement(name, nameEnd === -1 ? '' : body.slice(nameEnd), selfClosing)
          }
        }
        end = close === -1 ? -1 : close + 1
      }
      if (end === -1) break
      position = end
    }
    buffer = text.slice(position)
    if (failure === undefined && buffer.length > XMLTV_MAX_TOKEN_CHARS) failure = 'token_too_large'
  }

  return {
    /** Feeds the next decoded chunk; a failure stops the read. */
    push: (chunk: string): Result<void, XmltvParseFailure> => {
      if (failure !== undefined) return err(failure)
      buffer += chunk
      consume(false)
      return failure === undefined ? ok() : err(failure)
    },
    /** Ends the read: a document whose first element is not `<tv>` is not a guide. */
    finish: (): Result<void, XmltvParseFailure> => {
      if (failure === undefined) consume(true)
      if (failure === undefined && !rootSeen) failure = 'not_xmltv'
      return failure === undefined ? ok() : err(failure)
    },
  }
}
