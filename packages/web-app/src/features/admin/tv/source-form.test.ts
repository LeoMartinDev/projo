import { describe, expect, test } from 'bun:test'

import type { AdminTvSourceDto } from '@projo/shared/api/tv'

import {
  emptySourceForm,
  invalidSourceFields,
  isEmptyPatch,
  sourceFormOf,
  toCreateBody,
  toPatchBody,
} from './source-form.ts'

const source: AdminTvSourceDto = {
  id: 's1',
  name: 'Box',
  kind: 'm3u',
  settings: {
    kind: 'm3u',
    playlistUrl: 'http://provider.example/…',
    guideUrl: 'http://guide.example/…',
    userAgent: 'VLC',
  },
  maxConnections: 2,
  channelCount: 10,
  enabledChannelCount: 3,
  state: 'ready',
  failureCount: 0,
  createdAt: '2026-11-01T10:00:00.000Z',
}

describe('invalidSourceFields', () => {
  test('a new source needs a name and an http playlist URL', () => {
    expect([...invalidSourceFields(emptySourceForm, { creating: true })]).toEqual([
      'name',
      'playlistUrl',
    ])
    expect([
      ...invalidSourceFields(
        { ...emptySourceForm, name: 'Box', playlistUrl: 'ftp://x/list.m3u' },
        { creating: true },
      ),
    ]).toEqual(['playlistUrl'])
  })

  test('an existing source keeps its playlist URL when the field is empty', () => {
    expect(invalidSourceFields(sourceFormOf(source), { creating: false }).size).toBe(0)
  })

  test('a connection limit is a whole number from 1', () => {
    for (const value of ['0', '1.5', 'two', '-1'])
      expect(
        invalidSourceFields(
          { ...sourceFormOf(source), maxConnections: value },
          { creating: false },
        ),
      ).toEqual(new Set(['maxConnections']))
  })

  test('a User-Agent outside visible ASCII is flagged', () => {
    for (const value of ['Télé/1', 'Box\u0001'])
      expect(
        invalidSourceFields({ ...sourceFormOf(source), userAgent: value }, { creating: false }),
      ).toEqual(new Set(['userAgent']))
  })
})

describe('toCreateBody', () => {
  test('leaves out the empty optional fields', () => {
    expect(
      toCreateBody({ ...emptySourceForm, name: ' Box ', playlistUrl: ' http://p.example/l.m3u ' }),
    ).toEqual({ name: 'Box', settings: { kind: 'm3u', playlistUrl: 'http://p.example/l.m3u' } })
  })

  test('sends the guide and the User-Agent when set', () => {
    expect(
      toCreateBody({
        ...emptySourceForm,
        name: 'Box',
        playlistUrl: 'http://p.example/l.m3u',
        guideUrl: 'http://p.example/epg.xml',
        userAgent: 'VLC',
      }).settings,
    ).toEqual({
      kind: 'm3u',
      playlistUrl: 'http://p.example/l.m3u',
      guideUrl: 'http://p.example/epg.xml',
      userAgent: 'VLC',
    })
  })
})

describe('toPatchBody', () => {
  test('an untouched form changes nothing', () => {
    expect(isEmptyPatch(toPatchBody(source, sourceFormOf(source)))).toBe(true)
  })

  test('sends only the typed URLs', () => {
    expect(
      toPatchBody(source, { ...sourceFormOf(source), playlistUrl: 'http://new.example/l.m3u' }),
    ).toEqual({ settings: { kind: 'm3u', playlistUrl: 'http://new.example/l.m3u' } })
  })

  test('removes the guide, the User-Agent and the limit with empty values', () => {
    expect(
      toPatchBody(source, {
        ...sourceFormOf(source),
        removeGuide: true,
        userAgent: '',
        maxConnections: '',
      }),
    ).toEqual({ settings: { kind: 'm3u', guideUrl: '', userAgent: '' }, maxConnections: '' })
  })

  test('renames and sets a new limit', () => {
    expect(
      toPatchBody(source, { ...sourceFormOf(source), name: 'Living room', maxConnections: '4' }),
    ).toEqual({ name: 'Living room', maxConnections: 4 })
  })
})
