import { describe, expect, test } from 'bun:test'

import { decodeSubtitle, detectSubtitleCharset } from './subtitle-charset.ts'

const latin1 = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)))

describe('detectSubtitleCharset (§10.4)', () => {
  test('UTF-8, with or without BOM', () => {
    const bytes = new TextEncoder().encode('Été, déjà vu')
    expect(detectSubtitleCharset(bytes)).toBe('utf-8')
    expect(detectSubtitleCharset(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toBe('utf-8')
  })

  test('Latin-1 / Windows-1252 French text', () => {
    const bytes = new Uint8Array([...latin1('Été, déjà vu, '), 0x80, 0x9c])
    expect(detectSubtitleCharset(bytes)).toBe('windows-1252')
    expect(decodeSubtitle(bytes, 'windows-1252')).toBe('Été, déjà vu, €œ')
  })

  test('UTF-16 by its BOM', () => {
    expect(detectSubtitleCharset(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe('utf-16le')
    expect(detectSubtitleCharset(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toBe('utf-16be')
    expect(decodeSubtitle(new Uint8Array([0xff, 0xfe, 0xe9, 0x00]), 'utf-16le')).toBe('é')
  })

  test('plain ASCII is UTF-8', () => {
    expect(detectSubtitleCharset(latin1('1\n00:00:01,000 --> 00:00:02,000\nHi\n'))).toBe('utf-8')
  })
})
