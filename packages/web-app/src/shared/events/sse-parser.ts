/** One event of a `text/event-stream` (the `type` is `message` when the stream names none). */
export type SseEvent = { type: string; data: string }

const lineBreak = /\r\n|\r|\n/

/**
 * Incremental parser of a `text/event-stream` body (the WHATWG rules `EventSource` follows): feed
 * it the decoded text as it arrives, in chunks cut anywhere; it emits each complete event.
 * Comments (`: keep-alive`), `id` and `retry` are skipped: nothing here resumes a stream.
 */
export const createSseParser = (emit: (event: SseEvent) => void) => {
  let pending = ''
  // The previous chunk ended on `\r`: a `\n` starting the next one belongs to that line break.
  let afterCr = false
  let type = ''
  let data: string | undefined

  const dispatch = () => {
    if (data !== undefined) emit({ type: type === '' ? 'message' : type, data })
    type = ''
    data = undefined
  }

  const line = (text: string) => {
    if (text === '') return dispatch()
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    const raw = colon === -1 ? '' : text.slice(colon + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'event') type = value
    else if (field === 'data') data = data === undefined ? value : `${data}\n${value}`
  }

  return {
    push: (chunk: string): void => {
      const text = afterCr && chunk.startsWith('\n') ? chunk.slice(1) : chunk
      if (text === '') return
      afterCr = text.endsWith('\r')
      const lines = (pending + text).split(lineBreak)
      pending = lines.pop() ?? ''
      for (const each of lines) line(each)
    },
  }
}
