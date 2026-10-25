import { expect, test } from 'bun:test'

import { detectImageType } from './image-type.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (text: string) => new TextEncoder().encode(text)

test('JPEG, PNG and WebP are told by their magic bytes', () => {
  expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('jpeg')
  expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('png')
  expect(
    detectImageType(Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')])),
  ).toBe('webp')
})

test('anything else is refused, whatever its name says', () => {
  expect(detectImageType(ascii('GIF89a……'))).toBeUndefined()
  expect(detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined()
  expect(detectImageType(Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('AVI ')]))).toBe(
    undefined,
  )
  expect(detectImageType(bytes(0xff, 0xd8))).toBeUndefined()
  expect(detectImageType(new Uint8Array())).toBeUndefined()
})
