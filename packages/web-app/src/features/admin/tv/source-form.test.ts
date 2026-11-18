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

describe('channel snapshots (§29.4)', () => {
  test("start with the source's, its default applied; only a change is sent", () => {
    const form = sourceFormOf(source)
    expect(form).toMatchObject({ snapshots: true, snapshotGrabsPerHour: '60' })
    expect(sourceFormOf({ ...source, maxConnections: 1, snapshots: undefined }).snapshots).toBe(
      false,
    )
    expect(toPatchBody(source, { ...form, snapshots: false })).toEqual({ snapshots: false })
    expect(toPatchBody(source, { ...form, snapshotGrabsPerHour: '30' })).toEqual({
      snapshotGrabsPerHour: 30,
    })
  })

  test('the grabs per hour are a whole number from 1 to 600', () => {
    const form = sourceFormOf(source)
    for (const value of ['0', '601', '1.5', ''])
      expect(
        invalidSourceFields({ ...form, snapshotGrabsPerHour: value }, { creating: false }),
      ).toContain('snapshotGrabsPerHour')
    expect(
      invalidSourceFields({ ...form, snapshotGrabsPerHour: '600' }, { creating: false }),
    ).not.toContain('snapshotGrabsPerHour')
    // Its field is disabled while the snapshots are off: it never blocks the save then.
    const off = { ...form, snapshots: false, snapshotGrabsPerHour: '0' }
    expect(invalidSourceFields(off, { creating: false })).not.toContain('snapshotGrabsPerHour')
    expect(toPatchBody(source, off)).toEqual({ snapshots: false })
  })
})

describe('a Freebox source', () => {
  const freebox: AdminTvSourceDto = {
    ...source,
    kind: 'freebox',
    settings: { kind: 'freebox', address: 'http://mafreebox.freebox.fr' },
  }

  test('starts with the default address, which must be an http origin', () => {
    const form = { ...emptySourceForm, kind: 'freebox' as const, name: 'Freebox' }
    expect(form.address).toBe('http://mafreebox.freebox.fr')
    expect(invalidSourceFields(form, { creating: true }).size).toBe(0)
    expect(toCreateBody(form)).toEqual({
      name: 'Freebox',
      settings: { kind: 'freebox', address: 'http://mafreebox.freebox.fr' },
    })
    for (const address of [
      '',
      'mafreebox.freebox.fr',
      'http://mafreebox.freebox.fr/api',
      'https://mafreebox.freebox.fr',
    ])
      expect(invalidSourceFields({ ...form, address }, { creating: true })).toEqual(
        new Set(['address']),
      )
  })

  test('its form holds the stored address; a patch sends it only when changed', () => {
    const form = sourceFormOf(freebox)
    expect(form).toMatchObject({ kind: 'freebox', address: 'http://mafreebox.freebox.fr' })
    expect(isEmptyPatch(toPatchBody(freebox, form))).toBe(true)
    expect(toPatchBody(freebox, { ...form, address: ' http://192.168.1.254 ' })).toEqual({
      settings: { kind: 'freebox', address: 'http://192.168.1.254' },
    })
    expect(toPatchBody(freebox, { ...form, maxConnections: '' })).toEqual({ maxConnections: '' })
  })
})

describe('an Xtream Codes source', () => {
  const xtream: AdminTvSourceDto = {
    ...source,
    kind: 'xtream',
    settings: { kind: 'xtream', serverUrl: 'http://line.example:8080' },
  }

  test('a new source needs the server URL, the username and the password', () => {
    const form = { ...emptySourceForm, kind: 'xtream' as const, name: 'Panel' }
    expect(invalidSourceFields(form, { creating: true })).toEqual(
      new Set(['serverUrl', 'username', 'password']),
    )
    const filled = {
      ...form,
      serverUrl: ' http://line.example:8080/ ',
      username: 'jo',
      password: 'p@ss/word',
      maxConnections: '3',
    }
    expect(invalidSourceFields(filled, { creating: true }).size).toBe(0)
    // The account sets the connection limit (§29.2): never sent.
    expect(toCreateBody(filled)).toEqual({
      name: 'Panel',
      settings: {
        kind: 'xtream',
        serverUrl: 'http://line.example:8080/',
        username: 'jo',
        password: 'p@ss/word',
      },
    })
    expect(
      invalidSourceFields(
        { ...filled, serverUrl: 'http://line.example/panel', password: 'with space' },
        { creating: true },
      ),
    ).toEqual(new Set(['serverUrl', 'password']))
  })

  test('empty credentials keep the stored ones; the limit is never patched', () => {
    const form = sourceFormOf(xtream)
    expect(form).toMatchObject({
      serverUrl: 'http://line.example:8080',
      username: '',
      password: '',
    })
    expect(invalidSourceFields(form, { creating: false }).size).toBe(0)
    expect(isEmptyPatch(toPatchBody(xtream, { ...form, maxConnections: '' }))).toBe(true)
    expect(toPatchBody(xtream, { ...form, password: 'new-pass' })).toEqual({
      settings: { kind: 'xtream', password: 'new-pass' },
    })
  })
})
