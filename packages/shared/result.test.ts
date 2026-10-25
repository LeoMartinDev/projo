import { describe, expect, test } from 'bun:test'

import {
  all,
  andThen,
  err,
  fromPromise,
  isErr,
  isOk,
  map,
  mapError,
  match,
  ok,
  type Result,
  unwrapOr,
} from './result.ts'

const parsePositive = (n: number): Result<number, string> => (n > 0 ? ok(n) : err('not_positive'))

describe('Result', () => {
  test('ok and err build tagged values', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 })
    expect(ok()).toEqual({ ok: true, value: undefined })
    expect(err('e')).toEqual({ ok: false, error: 'e' })
    expect(isOk(ok(1))).toBe(true)
    expect(isErr(err(1))).toBe(true)
  })

  test('map transforms only the value', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4))
    expect(map(err('e') as Result<number, string>, (n) => n * 2)).toEqual(err('e'))
  })

  test('mapError transforms only the error', () => {
    expect(mapError(err('e'), (e) => `${e}!`)).toEqual(err('e!'))
    expect(mapError(ok(1) as Result<number, string>, (e) => `${e}!`)).toEqual(ok(1))
  })

  test('andThen chains and short-circuits', () => {
    expect(andThen(ok(3), parsePositive)).toEqual(ok(3))
    expect(andThen(ok(-1), parsePositive)).toEqual(err('not_positive'))
    expect(andThen(err('first') as Result<number, string>, parsePositive)).toEqual(err('first'))
  })

  test('match folds both branches', () => {
    const fold = (r: Result<number, string>) =>
      match(r, { ok: (n) => `value ${n}`, err: (e) => `error ${e}` })
    expect(fold(ok(1))).toBe('value 1')
    expect(fold(err('x'))).toBe('error x')
  })

  test('unwrapOr returns the fallback on error', () => {
    expect(unwrapOr(ok(1), 0)).toBe(1)
    expect(unwrapOr(err('e'), 0)).toBe(0)
  })

  test('all collects values in order or returns the first error', () => {
    expect(all([ok(1), ok('a'), ok(true)])).toEqual(ok([1, 'a', true]))
    expect(all([ok(1), err('first'), err('second')])).toEqual(err('first'))
    expect(all([])).toEqual(ok([]))
  })

  test('fromPromise maps resolution and rejection', async () => {
    expect(await fromPromise(Promise.resolve(1), () => 'never')).toEqual(ok(1))
    expect(await fromPromise(Promise.reject(new Error('boom')), () => 'rejected')).toEqual(
      err('rejected'),
    )
  })

  test('fromPromise also catches a synchronous throw in a thunk', async () => {
    const thunk = (): Promise<number> => {
      throw new Error('sync')
    }
    const result = await fromPromise(thunk, (cause) => (cause as Error).message)
    expect(result).toEqual(err('sync'))
  })
})
