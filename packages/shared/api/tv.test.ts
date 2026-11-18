import { expect, test } from 'bun:test'

import {
  createTvSourceBodySchema,
  DEFAULT_FREEBOX_ADDRESS,
  freeboxAddressSchema,
  tvHttpUrlSchema,
  tvUserAgentSchema,
  updateTvSourceBodySchema,
} from './tv.ts'

test('a source URL is an absolute http or https URL', () => {
  for (const url of [
    'http://provider.example/get.php?username=a&password=b&type=m3u_plus',
    'https://user:pass@provider.example:8443/list.m3u',
    ' HTTP://192.168.1.10:8080 ',
  ])
    expect(tvHttpUrlSchema.safeParse(url).success).toBe(true)
  for (const url of [
    'file:///etc/passwd',
    'rtsp://box/1',
    'http://',
    'provider.example/list',
    'http://a b/c',
  ])
    expect(tvHttpUrlSchema.safeParse(url).success).toBe(false)
})

test('a patch removes optional values with an empty string', () => {
  expect(
    updateTvSourceBodySchema.parse({
      settings: { kind: 'm3u', guideUrl: '', userAgent: '' },
      maxConnections: '',
    }),
  ).toEqual({ settings: { kind: 'm3u', guideUrl: '', userAgent: '' }, maxConnections: '' })
  expect(updateTvSourceBodySchema.safeParse({ maxConnections: 0 }).success).toBe(false)
})

test('a User-Agent is visible ASCII, a header value a fetch accepts', () => {
  for (const value of ['VLC/3.0.20 LibVLC/3.0.20', ' Mozilla/5.0 (X11; Linux) ~ '])
    expect(tvUserAgentSchema.safeParse(value).success).toBe(true)
  for (const value of ['Télé/1', 'Box\u0001', 'a\nb', 'Box\u007f', 'TV 📺'])
    expect(tvUserAgentSchema.safeParse(value).success).toBe(false)
})

test('a Freebox address is an http origin, nothing more', () => {
  for (const address of [
    DEFAULT_FREEBOX_ADDRESS,
    'http://192.168.1.254',
    'http://mafreebox.freebox.fr:80/',
    ' http://[fe80::1]:80 ',
  ])
    expect(freeboxAddressSchema.safeParse(address).success).toBe(true)
  for (const address of [
    '',
    'mafreebox.freebox.fr',
    'https://mafreebox.freebox.fr',
    'ftp://mafreebox.freebox.fr',
    'http://mafreebox.freebox.fr/api',
    'http://user:pass@mafreebox.freebox.fr',
    'http://mafreebox.freebox.fr?x=1',
    'http://mafreebox.freebox.fr#a',
  ])
    expect(freeboxAddressSchema.safeParse(address).success).toBe(false)
})

test('a Freebox source takes its address, a patch may omit it', () => {
  expect(
    createTvSourceBodySchema.parse({
      name: 'Freebox',
      settings: { kind: 'freebox', address: 'http://mafreebox.freebox.fr' },
    }).settings,
  ).toEqual({ kind: 'freebox', address: 'http://mafreebox.freebox.fr' })
  expect(updateTvSourceBodySchema.parse({ settings: { kind: 'freebox' } })).toEqual({
    settings: { kind: 'freebox' },
  })
})
