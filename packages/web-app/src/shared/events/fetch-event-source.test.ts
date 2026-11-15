import { expect, test } from 'bun:test'

import { createFetchEvents, eventsBackoffMs, fetchEventSource } from './fetch-event-source.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

const eventStream = { 'content-type': 'text/event-stream; charset=utf-8' }

const streamed = () => {
  const encoder = new TextEncoder()
  let control: ReadableStreamDefaultController<Uint8Array> | undefined
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      control = controller
    },
  })
  return {
    response: new Response(body, { headers: eventStream }),
    send: (text: string) => control?.enqueue(encoder.encode(text)),
    end: () => control?.close(),
  }
}

const record = (source: ReturnType<typeof fetchEventSource>, types: readonly string[]) => {
  const seen: string[] = []
  for (const type of types)
    source.addEventListener(type, (event) =>
      seen.push(event.data === '' ? type : `${type}:${event.data}`),
    )
  return seen
}

test('opens, then dispatches the named events of the stream as they arrive', async () => {
  const stream = streamed()
  const source = fetchEventSource({ connect: async () => stream.response })
  const seen = record(source, ['open', 'catalog.changed', 'error'])
  expect(source.readyState).toBe(0)
  await settle()
  expect(source.readyState).toBe(1)
  stream.send(': keep-alive\n\nevent: catalog.chan')
  stream.send('ged\ndata: {}\n\n')
  await settle()
  expect(seen).toEqual(['open', 'catalog.changed:{}'])
})

test('closes with an error, and says why, when the answer is not a 2xx event stream', async () => {
  for (const [response, status] of [
    [new Response('', { status: 401 }), 401],
    [new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), 200],
  ] as const) {
    const refusals: unknown[] = []
    const source = fetchEventSource({
      connect: async () => response,
      refused: (refusal) => refusals.push(refusal),
    })
    const seen = record(source, ['open', 'error'])
    await settle()
    expect(seen).toEqual(['error'])
    expect(source.readyState).toBe(2)
    expect(refusals).toEqual([{ status }])
  }
})

test('closes with an error when the request fails or the stream ends', async () => {
  const refusals: unknown[] = []
  const refused = fetchEventSource({
    connect: () => Promise.reject(new TypeError('Failed to fetch')),
    refused: (refusal) => refusals.push(refusal),
  })
  const refusedSeen = record(refused, ['error'])
  const stream = streamed()
  const ended = fetchEventSource({ connect: async () => stream.response })
  const endedSeen = record(ended, ['open', 'error'])
  await settle()
  stream.end()
  await settle()
  expect(refusedSeen).toEqual(['error'])
  expect(refusals).toEqual([{}])
  expect(endedSeen).toEqual(['open', 'error'])
  expect(ended.readyState).toBe(2)
})

test('close() aborts the request and signals nothing more', async () => {
  const stream = streamed()
  let signal: AbortSignal | undefined
  const source = fetchEventSource({
    connect: async (abort) => {
      signal = abort
      return stream.response
    },
  })
  const seen = record(source, ['open', 'message', 'error'])
  await settle()
  source.close()
  stream.send('data: late\n\n')
  await settle()
  expect(signal?.aborted).toBe(true)
  expect(source.readyState).toBe(2)
  expect(seen).toEqual(['open'])
})

test('backs off longer after each stream that never opened, up to a minute', () => {
  expect([0, 1, 2, 3, 4, 5, 9].map(eventsBackoffMs)).toEqual([
    0, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000,
  ])
})

test('the desktop events: a 401 ends the session, refusals back off, an open stream resets', async () => {
  const waits: number[] = []
  const answers: (() => Response)[] = [
    () => new Response('', { status: 401 }),
    () => new Response('', { status: 503 }),
    () => streamed().response,
    () => new Response('', { status: 503 }),
  ]
  const open = createFetchEvents({
    connect: async () => (answers.shift() ?? (() => new Response('', { status: 500 })))(),
    wait: async (ms) => {
      waits.push(ms)
    },
  })
  let unauthorized = 0
  const context = {
    unauthorized: () => {
      unauthorized += 1
    },
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    open(context)
    await settle()
  }
  expect(unauthorized).toBe(1)
  expect(waits).toEqual([5_000, 10_000])
})
