import { describe, expect, test } from 'bun:test'

import type { TvGuideChannel, TvGuideProgramme } from '../../../core/tv/guide.ts'
import { createXmltvParser, decodeXmlEntities, XMLTV_MAX_TOKEN_CHARS } from './xmltv-parser.ts'

const guide = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<!-- generated -->
<tv generator-info-name="test" source-info-url="http://example.test/?a=1&amp;b=2">
  <channel id="news.one">
    <display-name lang="fr">News One</display-name>
    <display-name>N1</display-name>
    <icon src="http://example.test/n1.png"/>
  </channel>
  <channel id="empty"/>
  <programme start="20260610100000 +0200" stop="20260610110000 +0200" channel="news.one">
    <title lang="fr">Le journal &amp; la m&#233;t&#xE9;o</title>
    <title lang="en">The news</title>
    <sub-title lang="fr"><![CDATA[Édition <spéciale> & co]]></sub-title>
    <desc lang="fr">Les titres
      du jour &copy;</desc>
    <credits><director>Someone</director></credits>
    <category lang="fr">Info</category>
    <category lang="en">News</category>
    <icon src="http://img.example.test/journal.jpg?w=1&amp;h=2" width="640"/>
    <icon src="http://img.example.test/second.jpg"></icon>
    <episode-num system="onscreen">S02E05</episode-num>
    <episode-num system="xmltv_ns">1 . 4 . 0/1</episode-num>
    <rating system="CSA"><value>-10</value><icon src="http://example.test/csa.png"/></rating>
  </programme>
  <programme start="20260610110000 +0200" channel="news.one"><title/></programme>
  <programme start="soon" stop="20260610120000" channel="news.one"><title>Bad start</title></programme>
  <programme start="20260610120000" channel="news.one" stop="bad"><title>No stop</title></programme>
</tv>
`

const parseAll = (text: string, chunkSize: number) => {
  const channels: TvGuideChannel[] = []
  const programmes: TvGuideProgramme[] = []
  const parser = createXmltvParser({
    channel: (channel) => channels.push(channel),
    programme: (programme) => programmes.push(programme),
  })
  for (let index = 0; index < text.length; index += chunkSize) {
    const pushed = parser.push(text.slice(index, index + chunkSize))
    if (!pushed.ok) return { channels, programmes, result: pushed }
  }
  return { channels, programmes, result: parser.finish() }
}

describe('XMLTV parser (§29.3)', () => {
  test('reads channels and programmes, whatever the chunks (a tag, an entity, CDATA cut)', () => {
    const whole = parseAll(guide, guide.length)
    expect(whole.result.ok).toBe(true)
    expect(whole.channels).toEqual([
      { id: 'news.one', names: ['News One', 'N1'] },
      { id: 'empty', names: [] },
    ])
    expect(whole.programmes).toHaveLength(3)
    const [first, emptyTitle, open] = whole.programmes
    expect(first).toEqual({
      channel: 'news.one',
      start: new Date('2026-06-10T08:00:00.000Z'),
      stop: new Date('2026-06-10T09:00:00.000Z'),
      titles: [
        { lang: 'fr', text: 'Le journal & la météo' },
        { lang: 'en', text: 'The news' },
      ],
      subtitles: [{ lang: 'fr', text: 'Édition <spéciale> & co' }],
      descriptions: [{ lang: 'fr', text: 'Les titres\n      du jour &copy;' }],
      categories: [
        { lang: 'fr', text: 'Info' },
        { lang: 'en', text: 'News' },
      ],
      // The programme's own icons only (not a rating's), entities decoded.
      images: ['http://img.example.test/journal.jpg?w=1&h=2', 'http://img.example.test/second.jpg'],
      // xmltv_ns numbers win over the on-screen text.
      episode: { season: 2, episode: 5 },
    })
    expect(emptyTitle?.titles).toEqual([{ text: '' }])
    expect(emptyTitle?.images).toEqual([])
    expect(emptyTitle?.episode).toBeUndefined()
    expect(emptyTitle?.stop).toBeUndefined()
    // A stop that does not parse: none (the next programme closes it).
    expect(open).toMatchObject({ titles: [{ text: 'No stop' }] })
    expect(open?.stop).toBeUndefined()
    for (const size of [1, 2, 3, 7, 13, 64]) {
      const chunked = parseAll(guide, size)
      expect(chunked.result.ok).toBe(true)
      expect(chunked.channels).toEqual(whole.channels)
      expect(chunked.programmes).toEqual(whole.programmes)
    }
  })

  test('an on-screen episode alone is kept as text', () => {
    const { programmes } = parseAll(
      `<tv><programme channel="c" start="20260610100000"><title>T</title><episode-num system="onscreen">Épisode 12</episode-num><episode-num system="dd_progid">EP1</episode-num></programme></tv>`,
      3,
    )
    expect(programmes[0]?.episode).toEqual({ label: 'Épisode 12' })
  })

  test('quoted > in an attribute, single quotes, attributes in any order', () => {
    const { programmes, result } = parseAll(
      `<tv><programme channel='a>b' start='20260610100000'><title>T</title></programme></tv>`,
      5,
    )
    expect(result.ok).toBe(true)
    expect(programmes[0]).toMatchObject({ channel: 'a>b', titles: [{ text: 'T' }] })
  })

  test('a DOCTYPE internal subset closed by `]>` or `] >` is skipped, whatever the chunks', () => {
    for (const close of [']>', '] >', ']\n  >']) {
      const text = `<!DOCTYPE tv [\n  <!ENTITY x "y">\n${close}<tv><programme channel="c" start="20260610100000"><title>T</title></programme></tv>`
      for (const size of [1, 4, text.length]) {
        const { programmes, result } = parseAll(text, size)
        expect(result.ok).toBe(true)
        expect(programmes).toHaveLength(1)
      }
    }
  })

  test('a document that is not a guide fails, at once or at its end', () => {
    expect(parseAll('<html><body>expired</body></html>', 8).result).toEqual({
      ok: false,
      error: 'not_xmltv',
    })
    expect(parseAll('', 8).result).toEqual({ ok: false, error: 'not_xmltv' })
    expect(parseAll('<?xml version="1.0"?>\n<!-- only -->', 8).result).toEqual({
      ok: false,
      error: 'not_xmltv',
    })
  })

  test('a tag left open past 1 MB fails instead of growing', () => {
    const parser = createXmltvParser({ channel: () => {}, programme: () => {} })
    expect(parser.push('<tv><programme title="').ok).toBe(true)
    const chunk = 'x'.repeat(256 * 1024)
    let last = parser.push(chunk)
    for (let index = 0; index * chunk.length <= XMLTV_MAX_TOKEN_CHARS && last.ok; index += 1)
      last = parser.push(chunk)
    expect(last).toEqual({ ok: false, error: 'token_too_large' })
  })

  test('a long text run outside any field is skipped, not held', () => {
    const parser = createXmltvParser({ channel: () => {}, programme: () => {} })
    expect(parser.push('<tv><desc>').ok).toBe(true)
    for (let index = 0; index < 8; index += 1)
      expect(parser.push('y'.repeat(512 * 1024)).ok).toBe(true)
    expect(parser.push('</desc></tv>').ok).toBe(true)
    expect(parser.finish().ok).toBe(true)
  })
})

test('entities: the five of XML and numeric references; any other kept as written', () => {
  expect(decodeXmlEntities('a &lt;b&gt; &quot;c&quot; &apos;d&apos; &amp;amp;')).toBe(
    `a <b> "c" 'd' &amp;`,
  )
  expect(decodeXmlEntities('&#233;&#xe9;&#X1F3AC; &nbsp; &#0; &#xD800;')).toBe(
    'éé🎬 &nbsp; &#0; &#xD800;',
  )
})
