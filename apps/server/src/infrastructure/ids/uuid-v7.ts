import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'

type Deps = {
  clock: Clock
  randomBytes?: (length: number) => Uint8Array
}

const defaultRandomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length))

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * RFC 9562 UUID v7, pure JS. Monotonic within the process: when the clock does not advance,
 * the 12-bit `rand_a` field is used as a counter (method 1 of §6.2 of the RFC).
 */
export const createUuidV7Generator = ({
  clock,
  randomBytes = defaultRandomBytes,
}: Deps): IdGenerator => {
  let lastMs = -1
  let counter = 0

  return {
    next: () => {
      let ms = clock.now().getTime()
      const random = randomBytes(10)
      if (ms > lastMs) {
        lastMs = ms
        counter = (((random[0] ?? 0) & 0x07) << 8) | (random[1] ?? 0)
      } else {
        ms = lastMs
        counter += 1
        if (counter > 0xfff) {
          lastMs += 1
          ms = lastMs
          counter = 0
        }
      }

      const bytes = new Uint8Array(16)
      let time = ms
      for (let i = 5; i >= 0; i -= 1) {
        bytes[i] = time % 256
        time = Math.floor(time / 256)
      }
      bytes[6] = 0x70 | (counter >> 8)
      bytes[7] = counter & 0xff
      bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f)
      bytes.set(random.subarray(3, 10), 9)

      const h = hex(bytes)
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    },
  }
}
