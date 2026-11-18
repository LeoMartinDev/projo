import { describe, expect, test } from 'bun:test'

import {
  cleanCategories,
  cleanGuideText,
  createGuideCollector,
  episodeOfXmltv,
  guideKeyStem,
  guideNameOf,
  nowAndNextOf,
  parseXmltvTime,
  pickGuideText,
  programmeImageOf,
  settleProgrammes,
  type TvGuideProgramme,
  type TvProgramme,
} from './guide.ts'

const iso = (date: Date | undefined) => date?.toISOString()

describe('XMLTV times (§29.3)', () => {
  test('offsets are honoured and stored in UTC', () => {
    expect(iso(parseXmltvTime('20260610203000 +0200'))).toBe('2026-06-10T18:30:00.000Z')
    expect(iso(parseXmltvTime('20260610203000 -0500'))).toBe('2026-06-11T01:30:00.000Z')
    expect(iso(parseXmltvTime('20260610203000+0530'))).toBe('2026-06-10T15:00:00.000Z')
    expect(iso(parseXmltvTime('20260610203000 +02:00'))).toBe('2026-06-10T18:30:00.000Z')
    expect(iso(parseXmltvTime('20260610203000Z'))).toBe('2026-06-10T20:30:00.000Z')
  })

  test('without an offset, UTC; seconds are optional', () => {
    expect(iso(parseXmltvTime('20260610203000'))).toBe('2026-06-10T20:30:00.000Z')
    expect(iso(parseXmltvTime(' 202606102030 '))).toBe('2026-06-10T20:30:00.000Z')
  })

  test('across midnight and the end of a month', () => {
    expect(iso(parseXmltvTime('20260630233000 -0100'))).toBe('2026-07-01T00:30:00.000Z')
    expect(iso(parseXmltvTime('20260101003000 +0100'))).toBe('2025-12-31T23:30:00.000Z')
  })

  test('what names no real moment does not parse', () => {
    for (const value of [
      '',
      'tomorrow',
      '2026061020',
      '20261310203000',
      '20260631203000',
      '20260610246000',
      '20260610203000 +2500',
      '20260610203000 0200',
    ])
      expect(parseXmltvTime(value)).toBeUndefined()
  })
})

describe('texts (§29.3)', () => {
  test('the server language first, else one without lang, else the first', () => {
    const texts = [
      { lang: 'en', text: 'News' },
      { text: 'Neutral' },
      { lang: 'fr', text: 'Journal' },
    ]
    expect(pickGuideText(texts, 'fr-FR')).toBe('Journal')
    expect(pickGuideText(texts, 'en')).toBe('News')
    expect(pickGuideText(texts, 'de-DE')).toBe('Neutral')
    expect(
      pickGuideText(
        [
          { lang: 'en', text: 'News' },
          { lang: 'de', text: 'X' },
        ],
        'fr',
      ),
    ).toBe('News')
    expect(pickGuideText([{ lang: 'FR-ca', text: 'Nouvelles' }], 'fr-FR')).toBe('Nouvelles')
    expect(pickGuideText([{ lang: 'fr', text: '  ' }, { text: 'Kept' }], 'fr')).toBe('Kept')
    expect(pickGuideText([], 'fr')).toBeUndefined()
  })

  test('trimmed, whitespace collapsed, cut by characters', () => {
    expect(cleanGuideText('  Le \n journal\tdu soir ', 300)).toBe('Le journal du soir')
    expect(cleanGuideText('   ', 300)).toBeUndefined()
    expect(cleanGuideText('🎬🎬🎬', 2)).toBe('🎬🎬')
  })

  test('up to 3 categories with their lang, empty ones and repeats skipped', () => {
    expect(
      cleanCategories([
        { lang: 'fr', text: ' Film ' },
        { lang: 'en', text: '' },
        { lang: 'fr', text: 'FILM' },
        { lang: 'en', text: 'Movie' },
        { text: 'Comédie' },
        { lang: 'en', text: 'Comedy' },
      ]),
    ).toEqual([{ lang: 'fr', text: 'Film' }, { lang: 'en', text: 'Movie' }, { text: 'Comédie' }])
  })
})

describe('programme details (§29.3)', () => {
  test('the first absolute http or https image URL, 2,048 characters at most', () => {
    expect(
      programmeImageOf(['', 'ftp://p/a.jpg', '/relative.jpg', ' https://img.example/a.jpg ']),
    ).toBe('https://img.example/a.jpg')
    expect(programmeImageOf([`http://img.example/${'a'.repeat(2048)}`])).toBeUndefined()
    expect(programmeImageOf(['javascript:alert(1)', 'data:image/png;base64,AA'])).toBeUndefined()
    expect(programmeImageOf(undefined)).toBeUndefined()
  })

  test('xmltv_ns numbers are zero-based; onscreen is kept only without numbers', () => {
    expect(episodeOfXmltv([{ system: 'xmltv_ns', text: '1.4.0/1' }])).toEqual({
      season: 2,
      episode: 5,
    })
    expect(episodeOfXmltv([{ system: 'xmltv_ns', text: ' 0 / 3 . 11 / 22 . ' }])).toEqual({
      season: 1,
      episode: 12,
    })
    expect(episodeOfXmltv([{ system: 'xmltv_ns', text: '.6.' }])).toEqual({ episode: 7 })
    expect(
      episodeOfXmltv([
        { system: 'onscreen', text: 'S02E05' },
        { system: 'xmltv_ns', text: '1.4.' },
      ]),
    ).toEqual({ season: 2, episode: 5 })
    expect(
      episodeOfXmltv([
        { system: 'xmltv_ns', text: 'x.y.' },
        { system: 'onscreen', text: ' S02 E05 ' },
      ]),
    ).toEqual({ label: 'S02 E05' })
    expect(episodeOfXmltv([{ system: 'dd_progid', text: 'EP0123' }])).toBeUndefined()
    expect(episodeOfXmltv([])).toBeUndefined()
  })
})

describe('matching names and keys (§29.3)', () => {
  test('normalised names: case, accents, prefixes, brackets, quality words, symbols', () => {
    expect(guideNameOf('France  Télé 2')).toBe(guideNameOf('france tele2'))
    expect(guideNameOf('TF1 HD')).toBe('tf1')
    expect(guideNameOf('TF 1')).toBe('tf1')
    expect(guideNameOf('FR: TF1 FHD')).toBe('tf1')
    expect(guideNameOf('|FR| France 2 (1080p)')).toBe('france2')
    expect(guideNameOf('UK - BBC One [Geo-blocked]')).toBe('bbcone')
    expect(guideNameOf('Canal+ Sport [Not 24/7] 4K')).toBe('canalplussport')
    expect(guideNameOf('Arts & Crafts HEVC')).toBe('artsandcrafts')
    expect(guideNameOf('France 3 (Paris)')).toBe('france3paris')
    expect(guideNameOf('RTL-9')).toBe('rtl9')
    expect(guideNameOf('HD')).toBe('')
  })

  test('a guide key without its @ suffix, lowercased', () => {
    expect(guideKeyStem('France2.fr@SD')).toBe('france2.fr')
    expect(guideKeyStem('France2.fr')).toBe('france2.fr')
    expect(guideKeyStem('@odd')).toBe('@odd')
  })
})

const at = (time: string, day = '10') => new Date(`2026-06-${day}T${time}:00.000Z`)
const now = at('12:00')

describe('settling a channel (§29.3)', () => {
  const candidate = (start: Date, stop: Date | undefined, title: string) => ({
    start,
    ...(stop === undefined ? {} : { stop }),
    title,
    categories: [],
    kind: 'other' as const,
  })

  test('sorted, duplicates dropped (first read wins), overlaps cut, missing stops closed', () => {
    const settled = settleProgrammes(
      'c',
      [
        candidate(at('13:00'), at('14:00'), 'Thirteen'),
        candidate(at('11:30'), at('13:30'), 'Overlapping'),
        candidate(at('13:00'), at('13:45'), 'Duplicate'),
        candidate(at('14:00'), undefined, 'Open'),
        candidate(at('15:00'), undefined, 'Last open'),
      ],
      now,
    )
    expect(settled.map((p) => [p.title, iso(p.startAt), iso(p.endAt)])).toEqual([
      ['Overlapping', iso(at('11:30')), iso(at('13:00'))],
      ['Thirteen', iso(at('13:00')), iso(at('14:00'))],
      ['Open', iso(at('14:00')), iso(at('15:00'))],
    ])
  })

  test('from 6 hours ago to 3 days ahead; 600 at most', () => {
    const settled = settleProgrammes(
      'c',
      [
        candidate(at('05:00'), at('06:00'), 'Too old'),
        candidate(at('05:30'), at('06:30'), 'Six hours ago'),
        candidate(at('11:00'), at('11:00'), 'Empty'),
        candidate(at('11:59', '13'), at('13:00', '13'), 'In three days'),
        candidate(at('12:00', '13'), at('13:00', '13'), 'Too far'),
      ],
      now,
    )
    expect(settled.map((p) => p.title)).toEqual(['Six hours ago', 'In three days'])
    const many = Array.from({ length: 700 }, (_, index) =>
      candidate(
        new Date(now.getTime() + index * 60_000),
        new Date(now.getTime() + (index + 1) * 60_000),
        `P${index}`,
      ),
    )
    const capped = settleProgrammes('c', many, now)
    expect(capped).toHaveLength(600)
    expect(capped[0]?.title).toBe('P0')
  })
})

describe('collecting a guide (§29.3)', () => {
  const programme = (
    channel: string,
    start: Date,
    stop: Date | undefined,
    titles: TvGuideProgramme['titles'],
  ): TvGuideProgramme => ({
    channel,
    start,
    ...(stop === undefined ? {} : { stop }),
    titles,
    subtitles: [],
    descriptions: [],
    categories: [],
  })

  test('matches guide keys ignoring case, shared keys, and names when a key finds nothing', () => {
    const collector = createGuideCollector({
      channels: [
        { id: 'hd', name: 'News HD', group: 'News', guideKey: 'News.One' },
        { id: 'fhd', name: 'News FHD', group: 'News', guideKey: 'news.one' },
        { id: 'local', name: 'Télé Locale', group: '' },
        { id: 'quiet', name: 'Quiet', group: '', guideKey: 'quiet.tv' },
      ],
      now,
      language: 'fr-FR',
    })
    collector.sink.channel({ id: 'local.fr', names: ['Tele locale', 'TL'] })
    collector.sink.channel({ id: 'other.fr', names: ['TÉLÉ LOCALE'] })
    collector.sink.programme(
      programme('NEWS.ONE', at('11:00'), at('13:00'), [{ lang: 'fr', text: 'Le journal' }]),
    )
    collector.sink.programme(programme('local.fr', at('12:00'), at('12:30'), [{ text: 'Local' }]))
    collector.sink.programme(programme('other.fr', at('12:30'), at('13:00'), [{ text: 'Other' }]))
    collector.sink.programme(programme('absent', at('12:00'), at('13:00'), [{ text: 'Absent' }]))
    // A channel read after the first programme is not matched by name.
    collector.sink.channel({ id: 'late', names: ['Quiet'] })
    collector.sink.programme(programme('late', at('12:00'), at('13:00'), [{ text: 'Late' }]))
    const collected = collector.finish()
    const titlesOf = (channelId: string) =>
      collected.programmes.filter((p) => p.channelId === channelId).map((p) => p.title)
    expect(titlesOf('hd')).toEqual(['Le journal'])
    expect(titlesOf('fhd')).toEqual(['Le journal'])
    expect(titlesOf('local')).toEqual(['Local'])
    expect(titlesOf('quiet')).toEqual([])
    expect([...collected.matches]).toEqual([
      ['hd', 'NEWS.ONE'],
      ['fhd', 'NEWS.ONE'],
      ['local', 'local.fr'],
      ['quiet', undefined],
    ])
    expect(collected.guideChannels).toEqual([
      { id: 'local.fr', names: ['Tele locale', 'TL'] },
      { id: 'other.fr', names: ['TÉLÉ LOCALE'] },
    ])
  })

  test('the key exactly, then without its @ suffix, then the name; the admin choice wins', () => {
    const collector = createGuideCollector({
      channels: [
        { id: 'exact', name: 'France 2', group: '', guideKey: 'France2.fr@HD' },
        { id: 'stem', name: 'Anything', group: '', guideKey: 'France2.fr@SD' },
        { id: 'named', name: 'FR: France 2 FHD', group: '', guideKey: 'unknown.key' },
        {
          id: 'manual',
          name: 'France 2',
          group: '',
          guideKey: 'France2.fr@HD',
          guideChannel: 'TF1.fr',
        },
        { id: 'unlisted', name: 'Nowhere', group: '', guideKey: 'Hidden.fr@SD' },
      ],
      now,
      language: 'fr',
    })
    collector.sink.channel({ id: 'France2.fr', names: ['France 2'] })
    collector.sink.channel({ id: 'France2.fr@HD', names: ['France 2 HD'] })
    collector.sink.channel({ id: 'TF1.fr', names: ['TF1'] })
    for (const id of ['France2.fr', 'France2.fr@HD', 'TF1.fr', 'hidden.fr'])
      collector.sink.programme(programme(id, at('11:30'), at('12:30'), [{ text: id }]))
    const collected = collector.finish()
    const titlesOf = (channelId: string) =>
      collected.programmes.filter((p) => p.channelId === channelId).map((p) => p.title)
    expect(titlesOf('exact')).toEqual(['France2.fr@HD'])
    expect(titlesOf('stem')).toEqual(['France2.fr'])
    expect(titlesOf('named')).toEqual(['France2.fr'])
    expect(titlesOf('manual')).toEqual(['TF1.fr'])
    // A key no listed channel takes: the programmes of its key, else of its key without suffix.
    expect(titlesOf('unlisted')).toEqual(['hidden.fr'])
    expect(collected.matches.get('stem')).toBe('France2.fr')
    expect(collected.matches.get('manual')).toBe('TF1.fr')
    expect(collected.matches.get('unlisted')).toBe('hidden.fr')
  })

  test('a guide without channels (Freebox) matches on the key alone', () => {
    const collector = createGuideCollector({
      channels: [{ id: 'c', name: 'France 2', group: '', guideKey: 'uuid-webtv-201' }],
      now,
      language: 'fr',
    })
    collector.sink.programme(
      programme('uuid-webtv-201', at('11:30'), at('12:30'), [{ text: 'Journal' }]),
    )
    const collected = collector.finish()
    expect(collected.programmes.map((p) => p.title)).toEqual(['Journal'])
    expect(collected.guideChannels).toEqual([])
  })

  test('texts in the language, categories, kind, episode and image kept', () => {
    const collector = createGuideCollector({
      channels: [{ id: 'c', name: 'C', group: 'Sports', guideKey: 'c' }],
      now,
      language: 'en',
    })
    collector.sink.programme({
      channel: 'c',
      start: at('12:00'),
      stop: at('13:00'),
      titles: [
        { lang: 'fr', text: 'Le film' },
        { lang: 'en', text: ' The  film ' },
      ],
      subtitles: [{ lang: 'en', text: 'Part one' }],
      descriptions: [{ lang: 'fr', text: 'Un film.' }],
      categories: [
        { lang: 'fr', text: 'Film' },
        { lang: 'en', text: 'Movie' },
      ],
      images: ['https://img.example/film.jpg'],
      episode: { season: 1, episode: 2 },
    })
    collector.sink.programme(programme('c', at('13:00'), at('14:00'), [{ lang: 'en', text: ' ' }]))
    collector.sink.programme(programme('c', at('05:00'), at('05:30'), [{ text: 'Ended' }]))
    collector.sink.programme(
      programme('c', at('13:00', '13'), at('14:00', '13'), [{ text: 'Far' }]),
    )
    collector.sink.programme(programme('c', at('14:00'), at('15:00'), [{ text: 'No category' }]))
    expect(collector.finish().programmes).toEqual([
      {
        channelId: 'c',
        startAt: at('12:00'),
        endAt: at('13:00'),
        title: 'The film',
        subtitle: 'Part one',
        description: 'Un film.',
        // The server's language first.
        categories: [
          { lang: 'en', text: 'Movie' },
          { lang: 'fr', text: 'Film' },
        ],
        kind: 'movie',
        episode: { season: 1, episode: 2 },
        imageUrl: 'https://img.example/film.jpg',
      },
      {
        channelId: 'c',
        startAt: at('14:00'),
        endAt: at('15:00'),
        title: 'No category',
        categories: [],
        // The channel's kind: its group.
        kind: 'sport',
      },
    ])
  })

  test('an ended programme still closes the one without a stop before it', () => {
    const collector = createGuideCollector({
      channels: [{ id: 'c', name: 'C', group: '', guideKey: 'c' }],
      now,
      language: 'en',
    })
    collector.sink.programme(programme('c', at('04:00'), undefined, [{ text: 'Open' }]))
    collector.sink.programme(programme('c', at('05:00'), at('05:30'), [{ text: 'Ended' }]))
    collector.sink.programme(programme('c', at('13:00'), at('14:00'), [{ text: 'Later' }]))
    // Without "Ended", "Open" would run until 13:00 and be on now.
    expect(collector.finish().programmes.map((p) => p.title)).toEqual(['Later'])
  })
})

describe('now and next (§29.3)', () => {
  const programme = (start: string, end: string, title: string): TvProgramme => ({
    id: title,
    channelId: 'c',
    startAt: at(start),
    endAt: at(end),
    title,
    categories: [],
    kind: 'other',
    imageStored: false,
  })

  test('now holds the time, next starts after it; a gap has only next', () => {
    const a = programme('11:00', '12:30', 'A')
    const b = programme('12:30', '13:00', 'B')
    expect(nowAndNextOf([a, b], now)).toEqual({ now: a, next: b })
    expect(nowAndNextOf([programme('12:10', '13:00', 'Later')], now)).toEqual({
      next: programme('12:10', '13:00', 'Later'),
    })
    expect(nowAndNextOf([programme('11:00', '13:00', 'Only')], now)).toEqual({
      now: programme('11:00', '13:00', 'Only'),
    })
  })
})
