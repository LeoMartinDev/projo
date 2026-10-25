import { expect, test } from 'bun:test'
import { z } from 'zod'

import { parseTextJsonBody } from './validation.ts'

const schema = z.object({ positionMs: z.number() })

test('parses a text/plain JSON body', async () => {
  expect(await parseTextJsonBody({ text: async () => '{"positionMs":12}' }, schema)).toEqual({
    ok: true,
    value: { positionMs: 12 },
  })
})

test('a body lost with its connection is a validation error, not a crash', async () => {
  const closed = {
    text: () => Promise.reject(new DOMException('The connection was closed.', 'AbortError')),
  }
  expect(await parseTextJsonBody(closed, schema)).toMatchObject({
    ok: false,
    error: { code: 'common/validation_failed' },
  })
})
