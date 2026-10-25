import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { z } from 'zod'

import { appError, type AppError, err, fromPromise, ok, type Result } from '@projo/shared'

import { errorBody } from './errors.ts'

/**
 * Zod validation of a request part (§5.3 "validation at the boundaries"). On failure: 400
 * `common/validation_failed` with the issues in `context`. Keeps Hono RPC input types.
 *
 * `.post('/x', validate('json', schema), (c) => { const input = c.req.valid('json') … })`
 */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        errorBody(
          appError('common/validation_failed', `invalid request ${target}`, {
            context: { target, issues: result.error.issues },
          }),
        ),
        400,
      )
    }
    return undefined
  })

type ValidationError = AppError<'common/validation_failed'>

/** `JSON.parse` as a Result. */
export const parseJson = (text: string): Promise<Result<unknown, ValidationError>> =>
  fromPromise(
    async (): Promise<unknown> => JSON.parse(text),
    (cause) => appError('common/validation_failed', 'invalid JSON body', { cause }),
  )

/**
 * Body read as text whatever its content type, parsed as JSON and validated: for
 * `navigator.sendBeacon(url, JSON.stringify(body))`, which posts `text/plain;charset=UTF-8`.
 * Same error as `validate` (400 `common/validation_failed`), also for a body that cannot be read.
 */
export const parseTextJsonBody = async <Schema extends z.ZodType>(
  request: { text: () => Promise<string> },
  schema: Schema,
): Promise<Result<z.infer<Schema>, ValidationError>> => {
  // A beacon sent while the tab closes can lose its connection before the body is read.
  const text = await fromPromise(
    () => request.text(),
    (cause) => appError('common/validation_failed', 'request body unreadable', { cause }),
  )
  if (!text.ok) return text
  const json = await parseJson(text.value)
  if (!json.ok) return json
  const parsed = schema.safeParse(json.value)
  return parsed.success
    ? ok(parsed.data)
    : err(
        appError('common/validation_failed', 'invalid request body', {
          context: { target: 'text', issues: parsed.error.issues },
        }),
      )
}
