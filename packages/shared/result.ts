export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E> = Ok<T> | Err<E>

export type AsyncResult<T, E> = Promise<Result<T, E>>

export function ok(): Ok<void>
export function ok<T>(value: T): Ok<T>
export function ok<T>(value?: T): Ok<T | undefined> {
  return { ok: true, value }
}

export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok

export const map = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result

export const mapError = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(fn(result.error))

export const andThen = <T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> => (result.ok ? fn(result.value) : result)

export const match = <T, E, A, B = A>(
  result: Result<T, E>,
  handlers: { ok: (value: T) => A; err: (error: E) => B },
): A | B => (result.ok ? handlers.ok(result.value) : handlers.err(result.error))

export const unwrapOr = <T, E, D = T>(result: Result<T, E>, fallback: D): T | D =>
  result.ok ? result.value : fallback

type OkValues<R extends readonly Result<unknown, unknown>[]> = {
  -readonly [K in keyof R]: R[K] extends Result<infer T, unknown> ? T : never
}
type ErrValue<R extends readonly Result<unknown, unknown>[]> =
  R[number] extends Result<unknown, infer E> ? E : never

/** First error wins; otherwise the values in input order. */
export const all = <const R extends readonly Result<unknown, unknown>[]>(
  results: R,
): Result<OkValues<R>, ErrValue<R>> => {
  const values: unknown[] = []
  for (const result of results) {
    if (!result.ok) return result as Err<ErrValue<R>>
    values.push(result.value)
  }
  return ok(values as OkValues<R>)
}

/** Converts a rejection (or a synchronous throw inside `run`) into an `Err`. */
export const fromPromise = async <T, E>(
  run: Promise<T> | (() => Promise<T>),
  onRejected: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  const promise = typeof run === 'function' ? Promise.resolve().then(run) : run
  return promise.then(
    (value) => ok(value),
    (cause: unknown) => err(onRejected(cause)),
  )
}
