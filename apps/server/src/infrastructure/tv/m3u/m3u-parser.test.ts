import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { iptvFixturesDir } from '../../../../test/support/iptv-server.ts'
import { channelKeyOf, isFileUrl, parseAttributes, parseM3u } from './m3u-parser.ts'

const base = 'http://provider.test'
const fixture = (name: string) =>
  readFileSync(join(iptvFixturesDir, 'm3u', name), 'utf8').replaceAll('{{base}}', base)

describe('parseM3u on the fixture playlist', () => {
  const playlist = parseM3u(fixture('playlist.m3u'))
  const byName = new Map(playlist.channels.map((channel) => [channel.name, channel]))

  test('reads the header and counts every entry', () => {
    expect(playlist.header).toBe(true)
    expect(playlist.entries).toBe(15)
    expect(playlist.guideUrl).toBe(`${base}/xmltv/guide.xml.gz`)
  })

  test('keeps the live channels in playlist order, files, radios and other schemes left out', () => {
    expect(playlist.channels.map((channel) => channel.name)).toEqual([
      'News One HD',
      'News One FHD',
      'News Two',
      'Sport One',
      'Sport Two',
      'Kids One',
      'Local Channel',
      'Bare Name',
    ])
  })

  test('reads the attributes of an entry', () => {
    expect(byName.get('News One HD')).toEqual({
      key: 'tvg:news.one|News One HD',
      name: 'News One HD',
      number: 1,
      group: 'News',
      logoUrl: `${base}/logos/news-one.png`,
      upstream: { url: `${base}/live/news-one.ts` },
      guideKey: 'news.one',
    })
  })

  test('gives each quality of a channel sharing a tvg-id its own key', () => {
    expect(byName.get('News One FHD')?.key).toBe('tvg:news.one|News One FHD')
  })

  test('keeps the VLC options of an entry on its upstream only', () => {
    expect(byName.get('News Two')?.upstream).toEqual({
      url: `${base}/live/news-two.m3u8`,
      userAgent: 'ProviderPlayer/2.0',
      referrer: `${base}/portal`,
    })
    expect(byName.get('Sport One')?.upstream).toEqual({ url: `${base}/live/sport-one.ts` })
  })

  test('reads a comma inside a quoted group title', () => {
    expect(byName.get('Sport One')?.group).toBe('Sports, Live')
  })

  test('keys a channel without tvg-id on its group and name, and keeps rtsp and udp', () => {
    const sportTwo = byName.get('Sport Two')
    expect(sportTwo?.key).toBe('name:Sports, Live|Sport Two')
    expect(sportTwo?.guideKey).toBeUndefined()
    expect(sportTwo?.upstream.url).toBe('rtsp://127.0.0.1:8554/sport-two')
    expect(byName.get('Kids One')?.upstream.url).toBe('udp://@239.0.0.1:1234')
  })

  test('takes the group of #EXTGRP, and tvg-name when the title is empty', () => {
    expect(byName.get('Local Channel')?.group).toBe('Local')
    expect(byName.get('Bare Name')).toMatchObject({ group: 'Local', key: 'name:Local|Bare Name' })
  })

  test('keeps the first entry of a key listed twice', () => {
    expect(playlist.channels.filter((channel) => channel.guideKey === 'news.one')).toHaveLength(2)
    expect(byName.get('News One HD')?.group).toBe('News')
  })
})

describe('parseM3u edge cases', () => {
  test('accepts CRLF, a BOM and no header', () => {
    const playlist = parseM3u(
      '﻿#EXTINF:-1 tvg-chno="0" tvg-logo="ftp://x/y.png",  One   Channel \r\nhttp://a/1.ts\r\n',
    )
    expect(playlist.header).toBe(false)
    expect(playlist.entries).toBe(1)
    expect(playlist.channels).toEqual([
      {
        key: 'name:|One Channel',
        name: 'One Channel',
        group: '',
        upstream: { url: 'http://a/1.ts' },
      },
    ])
  })

  test('drops an entry without a name, and a URL without an entry', () => {
    expect(parseM3u('#EXTM3U\n#EXTINF:-1,\nhttp://a/1.ts\nhttp://a/2.ts\n').channels).toEqual([])
  })

  test('reads x-tvg-url and ignores a non-http guide', () => {
    expect(parseM3u('#EXTM3U x-tvg-url="https://g/epg.xml"').guideUrl).toBe('https://g/epg.xml')
    expect(parseM3u('#EXTM3U url-tvg="file:///epg.xml"').guideUrl).toBeUndefined()
  })

  test('an HTML page is neither a header nor an entry', () => {
    const playlist = parseM3u(fixture('expired.html'))
    expect({ header: playlist.header, entries: playlist.entries }).toEqual({
      header: false,
      entries: 0,
    })
  })
})

describe('helpers', () => {
  test('parseAttributes reads quoted, single-quoted and bare values', () => {
    expect([...parseAttributes(`-1 tvg-ID="a b" x='c' y=d`)]).toEqual([
      ['tvg-id', 'a b'],
      ['x', 'c'],
      ['y', 'd'],
    ])
  })

  test('isFileUrl spots video files and VOD paths, not live streams', () => {
    expect(isFileUrl('http://h/a/film.MKV')).toBe(true)
    expect(isFileUrl('http://h/movie/u/p/1.ts')).toBe(true)
    expect(isFileUrl('http://h/series/u/p/1.ts')).toBe(true)
    expect(isFileUrl('http://h/live/u/p/1.ts')).toBe(false)
    expect(isFileUrl('http://h/play.php?file=a.mkv')).toBe(false)
    expect(isFileUrl('http://h/hls/index.m3u8')).toBe(false)
  })

  test('channelKeyOf', () => {
    expect(channelKeyOf({ guideKey: 'a', group: 'g', name: 'n' })).toBe('tvg:a|n')
    expect(channelKeyOf({ group: 'g', name: 'n' })).toBe('name:g|n')
  })
})
