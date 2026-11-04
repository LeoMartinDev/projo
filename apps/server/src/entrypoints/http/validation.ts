import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { z } from 'zod'

import { appError, type AppError, err, fromPromise, ok, type Result } from '@projo/shared'

import { errorBody } from './errors.ts'

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

export const parseJson = (text: string): Promise<Result<unknown, ValidationError>> =>
  fromPromise(
    async (): Promise<unknown> => JSON.parse(text),
    (cause) => appError('common/validation_failed', 'invalid JSON body', { cause }),
  )

export const parseTextJsonBody = async <Schema extends z.ZodType>(
  request: { text: () => Promise<string> },
  schema: Schema,
): Promise<Result<z.infer<Schema>, ValidationError>> => {
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
