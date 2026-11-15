import { expect, test } from 'bun:test'

import { createSseParser, type SseEvent } from './sse-parser.ts'

const parse = (chunks: readonly string[]): SseEvent[] => {
  const events: SseEvent[] = []
  const parser = createSseParser((event) => events.push(event))
  for (const chunk of chunks) parser.push(chunk)
  return events
}

test('emits named events and skips comments', () => {
  expect(
    parse([
      ': keep-alive\n\nevent: scan.progress\ndata: {"a":1}\n\nevent: job.updated\ndata: {}\n\n',
    ]),
  ).toEqual([
    { type: 'scan.progress', data: '{"a":1}' },
    { type: 'job.updated', data: '{}' },
  ])
})

test('defaults the type to message and joins data lines', () => {
  expect(parse(['data: one\ndata:two\n\n'])).toEqual([{ type: 'message', data: 'one\ntwo' }])
})

test('waits for the blank line, across chunks cut anywhere', () => {
  const text = 'event: catalog.changed\ndata: {"x":"y"}\n\n'
  for (let cut = 1; cut < text.length; cut += 1)
    expect(parse([text.slice(0, cut), text.slice(cut)])).toEqual([
      { type: 'catalog.changed', data: '{"x":"y"}' },
    ])
  expect(parse(['event: a\ndata: 1\n'])).toEqual([])
})

test('accepts CRLF and CR line breaks, even split between chunks', () => {
  expect(parse(['event: a\r\ndata: 1\r\n\r\n'])).toEqual([{ type: 'a', data: '1' }])
  expect(parse(['event: a\rdata: 1\r\r'])).toEqual([{ type: 'a', data: '1' }])
  expect(parse(['event: a\r', '\ndata: 1\r', '\n\r', '\n'])).toEqual([{ type: 'a', data: '1' }])
})

test('drops an event without data and resets the type after each event', () => {
  expect(parse(['event: lonely\n\ndata: x\n\n'])).toEqual([{ type: 'message', data: 'x' }])
})

test('keeps an empty data field, and a value without a leading space as it is', () => {
  expect(parse(['data:\n\n', 'data:  two spaces\n\n'])).toEqual([
    { type: 'message', data: '' },
    { type: 'message', data: ' two spaces' },
  ])
})

test('ignores id, retry and unknown fields', () => {
  expect(parse(['id: 7\nretry: 1000\nfoo: bar\ndata: x\n\n'])).toEqual([
    { type: 'message', data: 'x' },
  ])
})
