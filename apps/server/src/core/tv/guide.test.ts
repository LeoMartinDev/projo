import { describe, expect, test } from 'bun:test'

import {
  cleanGuideText,
  createGuideCollector,
  guideNameOf,
  nowAndNextOf,
  parseXmltvTime,
  pickGuideText,
  settleProgrammes,
  type TvGuideProgramme,
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

  test('channel names match without case, accents nor whitespace', () => {
    expect(guideNameOf('France  Télé 2')).toBe(guideNameOf('france tele2'))
  })
})

const at = (time: string, day = '10') => new Date(`2026-06-${day}T${time}:00.000Z`)
const now = at('12:00')

describe('settling a channel (§29.3)', () => {
  const candidate = (start: Date, stop: Date | undefined, title: string) => ({
    start,
    ...(stop === undefined ? {} : { stop }),
    title,
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

  test('only what ends after now and starts within 24 hours; 200 at most', () => {
    const settled = settleProgrammes(
      'c',
      [
        candidate(at('10:00'), at('12:00'), 'Ended'),
        candidate(at('11:00'), at('11:00'), 'Empty'),
        candidate(at('11:59', '11'), at('13:00', '11'), 'Tomorrow'),
        candidate(at('12:00', '11'), at('13:00', '11'), 'Too far'),
      ],
      now,
    )
    expect(settled.map((p) => p.title)).toEqual(['Tomorrow'])
    const many = Array.from({ length: 300 }, (_, index) =>
      candidate(
        new Date(now.getTime() + index * 60_000),
        new Date(now.getTime() + (index + 1) * 60_000),
        `P${index}`,
      ),
    )
    expect(settleProgrammes('c', many, now)).toHaveLength(200)
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

  test('matches guide keys ignoring case, shared keys, and names when a channel has no key', () => {
    const collector = createGuideCollector({
      channels: [
        { id: 'hd', name: 'News HD', guideKey: 'News.One' },
        { id: 'fhd', name: 'News FHD', guideKey: 'news.one' },
        { id: 'local', name: 'Télé Locale' },
        { id: 'quiet', name: 'Quiet', guideKey: 'quiet.tv' },
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
      collected.filter((p) => p.channelId === channelId).map((p) => p.title)
    expect(titlesOf('hd')).toEqual(['Le journal'])
    expect(titlesOf('fhd')).toEqual(['Le journal'])
    expect(titlesOf('local')).toEqual(['Local'])
    expect(titlesOf('quiet')).toEqual([])
  })

  test('texts in the language, a programme without title skipped, out of window dropped', () => {
    const collector = createGuideCollector({
      channels: [{ id: 'c', name: 'C', guideKey: 'c' }],
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
      categories: [{ lang: 'en', text: 'Movie' }],
    })
    collector.sink.programme(programme('c', at('13:00'), at('14:00'), [{ lang: 'en', text: ' ' }]))
    collector.sink.programme(programme('c', at('09:00'), at('10:00'), [{ text: 'Ended' }]))
    collector.sink.programme(
      programme('c', at('13:00', '11'), at('14:00', '11'), [{ text: 'Far' }]),
    )
    expect(collector.finish()).toEqual([
      {
        channelId: 'c',
        startAt: at('12:00'),
        endAt: at('13:00'),
        title: 'The film',
        subtitle: 'Part one',
        description: 'Un film.',
        category: 'Movie',
      },
    ])
  })

  test('an ended programme still closes the one without a stop before it', () => {
    const collector = createGuideCollector({
      channels: [{ id: 'c', name: 'C', guideKey: 'c' }],
      now,
      language: 'en',
    })
    collector.sink.programme(programme('c', at('10:00'), undefined, [{ text: 'Open' }]))
    collector.sink.programme(programme('c', at('11:00'), at('11:30'), [{ text: 'Ended' }]))
    collector.sink.programme(programme('c', at('13:00'), at('14:00'), [{ text: 'Later' }]))
    // Without "Ended", "Open" would run until 13:00 and be on now.
    expect(collector.finish().map((p) => p.title)).toEqual(['Later'])
  })
})

describe('now and next (§29.3)', () => {
  const programme = (start: string, end: string, title: string) => ({
    channelId: 'c',
    startAt: at(start),
    endAt: at(end),
    title,
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
